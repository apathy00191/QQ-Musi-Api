/**
 * 搜索相关 API.
 *
 * MVP 范围: getHotkey / complete / quickSearch / generalSearch / searchByType
 * 注: 分页相关 PagerMeta 在 Node 版简化为可选回调, 业务可自行处理.
 */

import { ApiModule } from "./base.js";
import { Platform } from "../versioning.js";
import { getSearchId } from "../utils/common.js";

export const SearchType = {
  SONG: 0,
  SINGER: 1,
  ALBUM: 2,
  SONGLIST: 3,
  MV: 4,
  LYRIC: 7,
  USER: 8,
  AUDIO_ALBUM: 15,
  AUDIO: 18,
};

export class SearchApi extends ApiModule {
  /** 获取热搜词列表 */
  getHotkey() {
    return this._buildRequest(
      "music.musicsearch.HotkeyService",
      "GetHotkeyForQQMusicMobile",
      { search_id: getSearchId() },
    );
  }

  /** 搜索词补全建议 */
  complete(keyword) {
    return this._buildRequest(
      "music.smartboxCgi.SmartBoxCgi",
      "GetSmartBoxResult",
      {
        search_id: getSearchId(),
        query: keyword,
        num_per_page: 0,
        page_idx: 0,
      },
    );
  }

  /**
   * 快速搜索 (直接请求, 不走 cgi-bin 接口, 适用于无凭证场景)
   */
  async quickSearch(keyword) {
    const resp = await this._client.request(
      "GET",
      "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg",
      null,
      null,
      { params: { key: keyword } },
    );
    const data = resp.data;
    return data?.data;
  }

  /** 综合搜索 */
  generalSearch(keyword, page = 1, num = 15, searchid = null, pageStart = null, highlight = true) {
    const param = {
      searchid: searchid ?? getSearchId(),
      search_type: 100,
      page_num: num,
      query: keyword,
      page_id: page,
      highlight,
      grp: true,
    };
    if (pageStart) param.page_start = pageStart;
    return this._buildRequest(
      "music.adaptor.SearchAdaptor",
      "do_search_v2",
      param,
    );
  }

  /** 类型搜索 */
  searchByType(keyword, searchType = SearchType.SONG, num = 10, page = 1, searchid = null, highlight = true) {
    return this._buildRequest(
      "music.search.SearchCgiService",
      "DoSearchForQQMusicMobile",
      {
        searchid: searchid ?? getSearchId(),
        query: keyword,
        search_type: Number(searchType),
        num_per_page: num,
        page_num: page,
        highlight,
        grp: true,
      },
      { platform: Platform.ANDROID },
    );
  }
}
