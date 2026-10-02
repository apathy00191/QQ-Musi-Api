/**
 * GET /docs.json 数据源 (公开, 无需鉴权).
 *
 * 输出结构供 Web UI 渲染使用说明:
 *   { code: 0, message: "ok", data: { title, groups: [ { name, title, endpoints: [...] } ] } }
 *
 * 每个端点: { method, path, desc, auth: "bearer"|"admin"|"none", params: [{name, req, desc}], example }
 * 扩展代理端点参数摘自项目2 `各种qq音乐api，有搜索/src/routes/api-metadata.ts`.
 */

const B = "Bearer qmg_xxx"; // 示例令牌前缀
const BASE = "http://localhost:3400";

const p = (name, req, desc) => ({ name, req: Boolean(req), desc });

/** 基础分组 */
function basicGroup() {
  return {
    name: "basic",
    title: "基础",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        desc: "健康检查, 返回服务状态、登录态与当前 musicid",
        auth: "none",
        params: [],
        example: `curl "${BASE}/health"`,
      },
      {
        method: "GET",
        path: "/docs.json",
        desc: "本接口清单 (结构化端点文档), Web UI 据此渲染使用说明",
        auth: "none",
        params: [],
        example: `curl "${BASE}/docs.json"`,
      },
    ],
  };
}

/** 核心·搜索 */
function searchGroup() {
  const auth = "bearer";
  return {
    name: "search",
    title: "核心 · 搜索",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/search/hotkey",
        desc: "热搜词",
        auth,
        params: [],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/search/hotkey"`,
      },
      {
        method: "GET",
        path: "/api/v1/search/complete",
        desc: "搜索补全建议",
        auth,
        params: [p("keyword", true, "搜索关键词")],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/search/complete?keyword=周杰伦"`,
      },
      {
        method: "GET",
        path: "/api/v1/search/quick",
        desc: "快速搜索",
        auth,
        params: [p("keyword", true, "搜索关键词")],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/search/quick?keyword=晴天"`,
      },
      {
        method: "POST",
        path: "/api/v1/search/general",
        desc: "综合搜索 (JSON body)",
        auth,
        params: [
          p("keyword", true, "搜索关键词"),
          p("page", false, "页码, 默认 1"),
          p("num", false, "每页数量, 默认 15"),
          p("searchid", false, "搜索会话 ID, 默认自动生成"),
          p("pageStart", false, "起始偏移"),
          p("highlight", false, "是否高亮, 默认 true"),
        ],
        example: `curl -X POST -H "Authorization: ${B}" -H "Content-Type: application/json" -d '{"keyword":"周杰伦","page":1}' "${BASE}/api/v1/search/general"`,
      },
      {
        method: "POST",
        path: "/api/v1/search/byType",
        desc: "按类型搜索 (歌曲/专辑/歌手/歌单等)",
        auth,
        params: [
          p("keyword", true, "搜索关键词"),
          p("type", false, "SearchType, 默认歌曲"),
          p("num", false, "每页数量, 默认 10"),
          p("page", false, "页码, 默认 1"),
          p("searchid", false, "搜索会话 ID"),
          p("highlight", false, "是否高亮, 默认 true"),
        ],
        example: `curl -X POST -H "Authorization: ${B}" -H "Content-Type: application/json" -d '{"keyword":"周杰伦","type":"song"}' "${BASE}/api/v1/search/byType"`,
      },
    ],
  };
}

/** 核心·歌曲 */
function songGroup() {
  const auth = "bearer";
  return {
    name: "song",
    title: "核心 · 歌曲",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/song/detail",
        desc: "歌曲详情 (支持逗号分隔多个 mid)",
        auth,
        params: [p("mids", true, "songmid, 逗号分隔")],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/song/detail?mids=0039MnYb0qxYhV"`,
      },
      {
        method: "GET",
        path: "/api/v1/song/urls",
        desc: "播放直链 (17 种音质: DT03/AI00/Q000/Q001/Q003/D004/TL01/F000/O801/O800/O600/O400/M800/M500/C600/C400/C200)",
        auth,
        params: [
          p("mids", true, "songmid, 逗号分隔"),
          p("type", false, "音质代码, 默认 MP3_128 (M500)"),
        ],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/song/urls?mids=0039MnYb0qxYhV&type=FLAC"`,
      },
      {
        method: "GET",
        path: "/api/v1/song/lyric",
        desc: "歌词 (默认自动 QRC 解密, 含原文/翻译/罗马音)",
        auth,
        params: [
          p("mid", true, "songmid"),
          p("decode", false, "1=解密 (默认), 0=仅返回原始密文"),
        ],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/song/lyric?mid=0039MnYb0qxYhV&decode=1"`,
      },
      {
        method: "GET",
        path: "/api/v1/song/similar",
        desc: "相似歌曲 (展平为一维列表)",
        auth,
        params: [p("songid", true, "数字歌曲 ID (也接受 id 参数)")],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/song/similar?songid=97773"`,
      },
      {
        method: "GET",
        path: "/api/v1/song/relatedSonglist",
        desc: "相关歌单",
        auth,
        params: [p("mid", true, "songmid")],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/song/relatedSonglist?mid=0039MnYb0qxYhV"`,
      },
    ],
  };
}

/** 核心·用户 */
function userGroup() {
  const auth = "bearer";
  const uin = [p("uin", true, "用户 UIN"), p("page", false, "页码, 默认 1"), p("num", false, "每页数量, 默认 30")];
  return {
    name: "user",
    title: "核心 · 用户",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/user/self",
        desc: "当前登录用户信息 (需先在管理端登录)",
        auth,
        params: [],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/user/self"`,
      },
      {
        method: "GET",
        path: "/api/v1/user/info",
        desc: "指定用户信息",
        auth,
        params: [p("uin", true, "用户 UIN")],
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/user/info?uin=123456789"`,
      },
      {
        method: "GET",
        path: "/api/v1/user/songlist",
        desc: "用户歌单",
        auth,
        params: uin,
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/user/songlist?uin=123456789&page=1&num=30"`,
      },
      {
        method: "GET",
        path: "/api/v1/user/follows",
        desc: "关注列表",
        auth,
        params: uin,
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/user/follows?uin=123456789"`,
      },
      {
        method: "GET",
        path: "/api/v1/user/fans",
        desc: "粉丝列表",
        auth,
        params: uin,
        example: `curl -H "Authorization: ${B}" "${BASE}/api/v1/user/fans?uin=123456789"`,
      },
      {
        method: "POST",
        path: "/api/v1/user/follow",
        desc: "关注 / 取消关注 (JSON body)",
        auth,
        params: [
          p("uin", true, "目标用户 UIN"),
          p("follow", false, "true=关注 (默认), false=取消关注"),
        ],
        example: `curl -X POST -H "Authorization: ${B}" -H "Content-Type: application/json" -d '{"uin":"123456789","follow":true}' "${BASE}/api/v1/user/follow"`,
      },
    ],
  };
}

/** 管理·网关 */
function adminGroup() {
  const auth = "admin";
  const H = `-H "X-Admin-Token: <管理令牌>"`;
  return {
    name: "admin",
    title: "管理 · 网关",
    endpoints: [
      {
        method: "GET",
        path: "/admin/status",
        desc: "网关状态: 版本/鉴权模式/运行时长/令牌来源/扩展上游健康度",
        auth,
        params: [],
        example: `curl ${H} "${BASE}/admin/status"`,
      },
      {
        method: "GET",
        path: "/admin/tokens",
        desc: "列出全部 Bearer 令牌 (含明文 token 值)",
        auth,
        params: [],
        example: `curl ${H} "${BASE}/admin/tokens"`,
      },
      {
        method: "POST",
        path: "/admin/tokens",
        desc: "创建令牌 (JSON body {name}), 返回明文 token",
        auth,
        params: [p("name", true, "令牌名称")],
        example: `curl -X POST ${H} -H "Content-Type: application/json" -d '{"name":"my-app"}' "${BASE}/admin/tokens"`,
      },
      {
        method: "PATCH",
        path: "/admin/tokens/:id",
        desc: "更新令牌名称 / 启用状态",
        auth,
        params: [p("name", false, "新名称"), p("enabled", false, "true/false 启用禁用")],
        example: `curl -X PATCH ${H} -H "Content-Type: application/json" -d '{"enabled":false}' "${BASE}/admin/tokens/<id>"`,
      },
      {
        method: "DELETE",
        path: "/admin/tokens/:id",
        desc: "删除令牌",
        auth,
        params: [],
        example: `curl -X DELETE ${H} "${BASE}/admin/tokens/<id>"`,
      },
      {
        method: "POST",
        path: "/admin/tokens/:id/rotate",
        desc: "轮换令牌值 (保留 id 与统计)",
        auth,
        params: [],
        example: `curl -X POST ${H} "${BASE}/admin/tokens/<id>/rotate"`,
      },
      {
        method: "GET",
        path: "/admin/stats",
        desc: "调用统计: 按日期 total/byToken + 各令牌累计",
        auth,
        params: [],
        example: `curl ${H} "${BASE}/admin/stats"`,
      },
    ],
  };
}

/** 管理·登录凭证 */
function adminLoginGroup() {
  const auth = "admin";
  const H = `-H "X-Admin-Token: <管理令牌>"`;
  return {
    name: "admin-login",
    title: "管理 · 登录与凭证",
    endpoints: [
      {
        method: "GET",
        path: "/admin/login/status",
        desc: "登录状态 (loggedIn/expired/musicid/凭证文件路径)",
        auth,
        params: [],
        example: `curl ${H} "${BASE}/admin/login/status"`,
      },
      {
        method: "GET",
        path: "/admin/login/credential",
        desc: "查看凭证 (脱敏; ?raw=1 返回明文敏感字段)",
        auth,
        params: [p("raw", false, "1=包含敏感字段")],
        example: `curl ${H} "${BASE}/admin/login/credential?raw=1"`,
      },
      {
        method: "PUT",
        path: "/admin/login/credential",
        desc: "整体替换凭证 (JSON body, 格式同 credential 文件)",
        auth,
        params: [],
        example: `curl -X PUT ${H} -H "Content-Type: application/json" -d '{"musicid":"...","musickey":"..."}' "${BASE}/admin/login/credential"`,
      },
      {
        method: "DELETE",
        path: "/admin/login/credential",
        desc: "清空本地凭证 (仅清 musickey/musicid, 保留 device)",
        auth,
        params: [],
        example: `curl -X DELETE ${H} "${BASE}/admin/login/credential"`,
      },
      {
        method: "POST",
        path: "/admin/login/refresh",
        desc: "刷新凭证并落盘",
        auth,
        params: [],
        example: `curl -X POST ${H} "${BASE}/admin/login/refresh"`,
      },
      {
        method: "POST",
        path: "/admin/login/logout",
        desc: "服务端登出 + 本地清空凭证",
        auth,
        params: [],
        example: `curl -X POST ${H} "${BASE}/admin/login/logout"`,
      },
      {
        method: "POST",
        path: "/admin/login/qrcode",
        desc: "获取登录二维码 (QQ/微信/手机端), 返回 base64",
        auth,
        params: [p("type", false, "qq (默认) | wx | mobile")],
        example: `curl -X POST ${H} -H "Content-Type: application/json" -d '{"type":"qq"}' "${BASE}/admin/login/qrcode"`,
      },
      {
        method: "POST",
        path: "/admin/login/checkQrcode",
        desc: "轮询二维码扫码状态, 完成时返回凭证",
        auth,
        params: [p("identifier", true, "二维码标识"), p("type", false, "qq (默认) | wx")],
        example: `curl -X POST ${H} -H "Content-Type: application/json" -d '{"identifier":"xxx","type":"qq"}' "${BASE}/admin/login/checkQrcode"`,
      },
      {
        method: "POST",
        path: "/admin/login/sendAuthcode",
        desc: "发送手机验证码",
        auth,
        params: [p("phone", true, "手机号"), p("countryCode", false, "国际区号, 默认 86")],
        example: `curl -X POST ${H} -H "Content-Type: application/json" -d '{"phone":"13800138000"}' "${BASE}/admin/login/sendAuthcode"`,
      },
      {
        method: "POST",
        path: "/admin/login/phone",
        desc: "手机验证码登录, 成功后保存凭证",
        auth,
        params: [p("phone", true, "手机号"), p("code", true, "验证码")],
        example: `curl -X POST ${H} -H "Content-Type: application/json" -d '{"phone":"13800138000","code":"123456"}' "${BASE}/admin/login/phone"`,
      },
    ],
  };
}

/** 扩展·代理 (项目2 上游) */
function v2Group() {
  const auth = "bearer";
  const H = `-H "Authorization: ${B}"`;
  const eps = [
    ["GET", "/getHotkey", "热搜关键词 (上游 getHotKey)", []],
    [
      "GET",
      "/getSearchByKey",
      "关键词搜索 (歌曲等内容)",
      [p("key", true, "搜索关键词"), p("limit", false, "条数, 默认 10"), p("page", false, "页码"), p("catZhida", false, "是否含直达结果 0/1"), p("remoteplace", false, "搜索来源, 默认 song")],
    ],
    ["GET", "/getSmartbox", "智能搜索联想", [p("key", true, "搜索关键词")]],
    ["GET", "/getSongInfo", "歌曲详情 (songmid 或 songid)", [p("songmid", true, "歌曲 MID"), p("songid", false, "数字歌曲 ID")]],
    ["GET", "/getLyric", "歌词 (isFormat 可格式化)", [p("songmid", true, "歌曲 MID"), p("isFormat", false, "是否格式化, 默认 false"), p("cookie", false, "QQ 音乐 cookie")]],
    [
      "GET",
      "/getMusicPlay",
      "播放直链 (需有效登录 cookie)",
      [p("songmid", true, "歌曲 MID"), p("quality", false, "m4a/128/320/ape/flac, 默认 128"), p("resType", false, "play (默认) | raw"), p("mediaId", false, "默认取 songmid"), p("cookie", false, "QQ 音乐 cookie")],
    ],
    ["GET", "/getTopLists", "排行榜元数据", []],
    ["GET", "/getRanks", "排行榜详情歌曲", [p("topId", false, "榜单 ID, 默认 4"), p("page", false, "页码, 默认 0"), p("limit", false, "条数"), p("resolveMid", false, "逐首解析 songmid, 默认 false")]],
    ["GET", "/getSongListDetail", "歌单详情", [p("disstid", true, "歌单 ID")]],
    ["GET", "/getSongLists", "歌单列表", [p("limit", false, "条数"), p("page", false, "零基页码, 默认 0"), p("sortId", false, "排序 ID"), p("categoryId", false, "分类 ID")]],
    ["GET", "/getSongListCategories", "歌单分类", []],
    ["GET", "/getAlbumInfo", "专辑信息", [p("albummid", true, "专辑 MID")]],
    ["GET", "/getAlbumSongs", "专辑歌曲列表", [p("albummid", true, "专辑 MID"), p("albumid", false, "专辑数字 ID"), p("begin", false, "偏移, 默认 0"), p("limit", false, "条数"), p("order", false, "排序, 默认 2")]],
    ["GET", "/getSingerHotsong", "歌手热门歌曲", [p("singermid", true, "歌手 MID"), p("limit", false, "条数, 默认 5"), p("page", false, "页码, 默认 0")]],
    ["GET", "/getSingerList", "歌手列表 (分区/性别/流派/首字母)", [p("area", false, "地区, 默认 -100"), p("sex", false, "性别, 默认 -100"), p("genre", false, "流派, 默认 -100"), p("index", false, "首字母, 默认 -100"), p("page", false, "页码")]],
    [
      "GET",
      "/getComments",
      "评论列表 (歌曲/歌单/专辑)",
      [p("id", true, "资源 ID"), p("pagesize", false, "每页条数, 默认 25"), p("pagenum", false, "页码, 从 0 开始"), p("cid", false, "分类 ID"), p("cmd", false, "命令, 默认 8"), p("reqtype", false, "请求类型, 默认 2"), p("biztype", false, "1 歌曲/2 歌单/3 专辑, 默认 1"), p("rootcommentid", false, "热门评论分页游标")],
    ],
    ["GET", "/getRecommend", "首页推荐聚合", []],
    ["GET", "/getDailyRecommend", "每日推荐 (cookie 提升个性化)", [p("cookie", false, "QQ 音乐 cookie")]],
    ["GET", "/getQQLoginQr", "创建 QQ 登录二维码会话", []],
    ["GET", "/getMv", "MV 列表", [p("area_id", false, "地区, 默认 15"), p("version_id", false, "版本, 默认 7"), p("limit", false, "条数"), p("page", false, "页码, 0/1 均为第一页")]],
    ["GET", "/getMvPlay", "MV 播放信息", [p("vid", true, "MV 视频 ID")]],
    ["GET", "/getImageUrl", "构建专辑封面图片 URL", [p("id", true, "图片 MID"), p("size", false, "150x150/300x300/500x500/800x800"), p("maxAge", false, "CDN max_age 秒, 默认 2592000")]],
    ["GET", "/getSimilarSongs", "相似歌曲推荐", [p("songmid", true, "歌曲 MID"), p("cookie", false, "QQ 音乐 cookie")]],
  ];
  return {
    name: "v2",
    title: "扩展 · 代理 (需先启动扩展服务)",
    endpoints: eps.map(([method, path, desc, params]) => {
      const upstream = path;
      const qs = params
        .filter((x) => x.req)
        .map((x) => `${x.name}=`)
        .join("&");
      const url = `${BASE}/api/v2${upstream}${qs ? `?${qs}` : ""}`;
      const example =
        method === "GET"
          ? `curl -H "Authorization: ${B}" "${url}"`
          : `curl -X POST -H "Authorization: ${B}" -H "Content-Type: application/json" -d '{}' "${url}"`;
      return {
        method,
        path: `/api/v2${upstream}`,
        desc,
        auth,
        params,
        example,
      };
    }),
  };
}

/**
 * 构建 /docs.json 的 data 负载.
 * @returns {{ title: string, groups: Array<object> }}
 */
export function buildDocs() {
  return {
    title: "QQ Music Gateway API",
    intro:
      "统一网关: 核心接口 (/api/v1) 与扩展代理 (/api/v2) 使用 Bearer token 鉴权; 管理接口 (/admin) 使用 X-Admin-Token。扩展代理需先启动上游服务 (UPSTREAM_V2, 默认 http://127.0.0.1:3200)。",
    groups: [
      basicGroup(),
      searchGroup(),
      songGroup(),
      userGroup(),
      adminGroup(),
      adminLoginGroup(),
      v2Group(),
    ],
  };
}

export default buildDocs;
