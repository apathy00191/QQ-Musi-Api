/**
 *
 * MVP 范围:
 * - getDetail            获取歌曲详情
 * - getUrls              获取歌曲播放链接(根据音质)
 * - getLyrics            获取歌词原始数据
 * - getSimilar           相似歌曲
 * - getRelatedSonglist   关联歌单
 * 注: 完整音质枚举在 song_filetype.js 中, 这里是简化版.
 */

import { ApiModule } from "./base.js";
import { Platform } from "../versioning.js";
import { SongFileType, parseSongFileType } from "./song_filetype.js";
import { ApiDataError, CredentialInvalidError } from "../exceptions.js";

export class SongApi extends ApiModule {
  /**
   * 根据 mid 或 id 构造 get_song_detail_yqq 的 param.
   * - 纯数字字符串 -> song_id (数字 ID)
   * - 其他        -> song_mid (字符串 mid)
   */
  static _buildDetailParam(mid) {
    const s = String(mid);
    return /^\d+$/.test(s) ? { song_id: Number(s) } : { song_mid: s };
  }

  /**
   * 获取歌曲详情.
   * 固定使用 Web 平台.
   * 单个 mid 调用 get_song_detail_yqq, 多个 mid 并发并合并为 { tracks: [...] }.
   * @param {(string|number)[]} mids 歌曲 mid 列表 (字符串 mid 或数字 ID 均可)
   * @returns {Promise<{tracks: Array, extras?: Object}>}
   */
  async getDetail(mids) {
    if (mids.length === 0) return { tracks: [] };
    if (mids.length === 1) {
      const data = await this._client.execute(
        this._buildRequest(
          "music.pf_song_detail_svr",
          "get_song_detail_yqq",
          SongApi._buildDetailParam(mids[0]),
          { platform: Platform.WEB },
        ),
      );
      // 原始返回结构: { track_info: {...}, info: {...}, extras: {...} }
      return {
        tracks: data?.track_info ? [data.track_info] : [],
        extras: data?.extras,
      };
    }
    // 批量: 并发调用单个 detail 并合并
    const results = await Promise.allSettled(
      mids.map((mid) =>
        this._client
          .execute(
            this._buildRequest(
              "music.pf_song_detail_svr",
              "get_song_detail_yqq",
              SongApi._buildDetailParam(mid),
              { platform: Platform.WEB },
            ),
          )
          .then((d) => d?.track_info ?? null),
      ),
    );
    const tracks = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) tracks.push(r.value);
    }
    return { tracks };
  }

  /** 歌曲直链 CDN 域名 */
  static SONG_URL_FALLBACK_DOMAIN = "https://isure.stream.qqmusic.qq.com/";

  /** 获取歌曲播放链接 */
  getUrls(mids, fileType = SongFileType.MP3_128, options = {}) {
    if (mids.length === 0) {
      return this._buildRequest("music.vkey.GetVkey", "GetVkey", {
        songmid: mids,
      });
    }
    const type =
      typeof fileType === "string"
        ? { code: fileType, ext: this._inferExt(fileType) }
        : fileType;
    // filename 形如 M500{ mid }{ mid }.mp3, 某些 VIP 音质的 mid 不是 songmid 而是 media_mid
    const filename = mids.map((m) => `${type.code}${m}${m}${type.ext}`);
    const uin = this._client.credential?.strMusicid || this._client.credential?.musicid || "";
    return this._buildRequest(
      "music.vkey.GetVkey",
      "UrlGetVkey",
      {
        guid: options.guid ?? "",
        songmid: mids,
        songtype: new Array(mids.length).fill(0),
        filename,
        uin: String(uin),
        loginflag: 1,
        platform: "23",
        h5queryversion: 1,
        nettype: "",
        jsonpCallback: "jsonp1",
        cms: 0,
        firstlogin: 1,
        newver: 1,
        nohash: 0,
        format: "json",
        inCharset: "utf-8",
        outCharset: "utf-8",
        notice: 0,
        needNewCode: 0,
        songmid_pre: "",
        soundname: "",
        bitrate: options.bitrate ?? 0,
        quality: type.code,
      },
    );
  }

  /** 根据 quality code 推断文件后缀(用于生成 filename) */
  _inferExt(code) {
    const c = code.toUpperCase();
    if (c === "AI00" || c === "Q000" || c === "Q001" || c === "F000") return ".flac";
    if (c === "O801" || c === "O800" || c === "O600" || c === "O400") return ".ogg";
    if (c === "M800" || c === "M500") return ".mp3";
    if (c === "C600" || c === "C400" || c === "C200") return ".m4a";
    if (c === "DT03" || c === "D004") return ".mp4";
    if (c === "Q003") return ".ogg";
    if (c === "TL01") return ".nac";
    return ".mp3";
  }

  /**
   * 判断输入是否为 song_id (纯数字).
   */
  static _isSongId(mid) {
    return /^\d+$/.test(String(mid));
  }

  /**
   * 将入参中的 song_id 转换为 mid.
   * - 纯数字 -> 调用 getDetail 获取对应 mid
   * - 其他   -> 原样返回
   * 返回 { midList, idToMidMap }
   *   - midList: 全部转换为 mid 后的列表 (与入参同序)
   *   - idToMidMap: song_id -> mid 的映射 (用于回填结果 key)
   */
  async _resolveToMids(mids) {
    const midList = [];
    const idToMidMap = {};
    const needLookup = []; // 需要查 getDetail 的索引
    for (let i = 0; i < mids.length; i++) {
      const m = mids[i];
      if (SongApi._isSongId(m)) {
        needLookup.push({ index: i, id: String(m) });
      } else {
        midList[i] = String(m);
      }
    }
    if (needLookup.length > 0) {
      // 用 song_id 批量查详情, 拿到 mid
      const detail = await this.getDetail(needLookup.map((it) => it.id));
      const tracks = detail?.tracks ?? [];
      for (let j = 0; j < needLookup.length; j++) {
        const { index, id } = needLookup[j];
        const track = tracks[j];
        const mid = track?.mid ?? "";
        midList[index] = mid;
        if (mid) idToMidMap[id] = mid;
      }
    }
    return { midList, idToMidMap };
  }

  /**
   * 获取歌曲播放直链 (高层封装, 自动处理 guid).
   * 入参支持 mid (字符串) 或 song_id (纯数字).
   * - 若传入 song_id, 会自动调用 getDetail 转换为 mid 后再获取直链.
   * - 返回结构的 key 与入参一致 (传 song_id 则返回 song_id 作为 key).
   * @param {(string|number)[]} mids 歌曲 mid 或 song_id 列表
   * @param {string|SongFileType} fileType
   * @returns {Promise<Object<string, {url, vkey, size, error?}>>}
   */
  async getPlayUrls(mids, fileType = SongFileType.MP3_128) {
    if (mids.length === 0) return {};
    const type = typeof fileType === "string" ? fileType : fileType.code;

    // 1. 将 song_id 转换为 mid
    const { midList, idToMidMap } = await this._resolveToMids(mids);
    // mid -> 原始入参 (用于回填返回结果的 key)
    const midToOriginal = {};
    for (let i = 0; i < mids.length; i++) {
      const orig = String(mids[i]);
      const mid = midList[i];
      if (mid) midToOriginal[mid] = orig;
    }
    // 过滤掉转换失败的项
    const validMids = midList.filter(Boolean);
    if (validMids.length === 0) return {};

    // 2. 用 mid 调用 vkey 接口
    const device = await this._client.getDevice();
    const data = await this._client.execute(
      this.getUrls(validMids, type, { guid: device.openUdid }),
    );

    // 3. 解析响应, 并把 key 从 mid 回填为原始入参
    const map = {};
    const sip = Array.isArray(data?.sip) && data.sip.length > 0 ? data.sip : null;
    for (const item of data?.midurlinfo ?? []) {
      const mid = item.songmid;
      const origKey = midToOriginal[mid] ?? mid;
      if (!item.purl) {
        map[origKey] = {
          url: "",
          vkey: item.vkey,
          size: 0,
          error:
            item.result === 104003
              ? "无权限 / 需要 VIP"
              : item.result === 104004
                ? "VKey 获取失败"
                : "无可用直链",
        };
        continue;
      }
      let url;
      if (/^https?:\/\//i.test(item.purl)) {
        url = item.purl;
      } else if (sip) {
        url = sip[Math.floor(Math.random() * sip.length)] + item.purl;
      } else {
        url = SongApi.SONG_URL_FALLBACK_DOMAIN + item.purl;
      }
      map[origKey] = {
        url,
        vkey: item.vkey,
        size: 0,
        error: undefined,
      };
    }
    // 4. 对转换失败的 song_id (mid 为空) 补充错误信息
    for (const m of mids) {
      const orig = String(m);
      if (midToOriginal[idToMidMap[orig]] === orig) continue; // 已处理
      if (SongApi._isSongId(orig) && !idToMidMap[orig]) {
        map[orig] = {
          url: "",
          vkey: "",
          size: 0,
          error: "song_id 查询详情失败, 无法获取 mid",
        };
      }
    }
    return map;
  }

  /**
   * 获取歌词(原始数据, 含 QRC 加密与解密后的 LRC 文本).
   * 入参支持 mid (字符串) 或 song_id (纯数字).
   * - song_id -> 传 songId 字段
   * - mid     -> 传 songMID 字段
   * @param {string|number} mid 歌曲 mid 或 song_id
   * @param {{qrc?:boolean, trans?:boolean, roma?:boolean}} options
   */
  getLyrics(mid, options = {}) {
    const { qrc = true, trans = true, roma = false } = options;
    const isSongId = SongApi._isSongId(mid);
    const idParam = isSongId
      ? { songId: Number(mid) }
      : { songMID: String(mid) };
    return this._buildRequest(
      "music.musichallSong.PlayLyricInfo",
      "GetPlayLyricInfo",
      {
        ...idParam,
        crypt: 1,
        lrc_t: 0,
        qrc: qrc ? 1 : 0,
        qrc_t: 0,
        roma: roma ? 1 : 0,
        roma_t: 0,
        trans: trans ? 1 : 0,
        trans_t: 0,
        type: 1,
        userIP: "127.0.0.1",
        ...this._buildQueryCommonParams(Platform.ANDROID),
      },
      { platform: Platform.ANDROID },
    );
  }

  /** 相似歌曲 (使用歌曲数字 ID, 需登录) */
  getSimilar(songid) {
    const id = typeof songid === "string" ? Number(songid) : songid;
    if (!Number.isFinite(id) || id <= 0) {
      throw new ApiDataError("getSimilar 需要有效的歌曲 ID (数字)");
    }
    return this._buildRequest(
      "music.recommend.TrackRelationServer",
      "GetSimilarSongs",
      { songid: id },
    );
  }

  /** 关联歌单 */
  getRelatedSonglist(mid) {
    return this._buildRequest(
      "music.video.InfoService",
      "GetRelatedSongList",
      { songmid: mid },
    );
  }

  /**
   * 获取歌曲播放 URL 的高层封装 (需要登录).
   * 自动从 credentials 中读取 uin 并拼接到返回的 URL 中.
   */
  async getPlayUrl(mid, fileType = SongFileType.MP3_128) {
    if (!this._client.credential.musicid) {
      throw new CredentialInvalidError("获取播放链接需要登录凭证");
    }
    const urls = await this.getPlayUrls([mid], fileType);
    return urls[mid]?.url ?? "";
  }
}

// 重新导出
export { SongFileType, parseSongFileType } from "./song_filetype.js";
