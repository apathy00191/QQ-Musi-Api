/**
 * 用户相关 API.
 *
 * MVP 范围:
 * - getSelfInfo          获取当前登录用户信息
 * - getUserInfo          根据 uin 获取用户信息
 * - getUserSonglist      获取用户歌单
 * - getUserFollows       获取关注列表
 * - getUserFans          获取粉丝列表
 */

import { ApiModule } from "./base.js";

export class UserApi extends ApiModule {
  /** 获取当前登录用户信息 */
  getSelfInfo() {
    return this._buildRequest(
      "music.UserInfo.userInfoServer",
      "GetLoginUserInfo",
      {},
      { requireLogin: true },
    );
  }

  /** 根据 QQ 号获取用户信息 */
  getUserInfo(uin) {
    return this._buildRequest(
      "music.UserInfo.userInfoServer",
      "GetUserInfo",
      { uin: String(uin) },
    );
  }

  /** 获取用户歌单 */
  getUserSonglist(uin, page = 1, num = 30, options = {}) {
    return this._buildRequest(
      "music.songlist.UserSonglistService",
      "GetUserSonglist",
      {
        uin: String(uin),
        page,
        num,
        sort: options.sort ?? 5,
        onlyPlayList: options.onlyPlayList ?? true,
      },
    );
  }

  /** 获取关注列表 */
  getUserFollows(uin, page = 1, num = 30) {
    return this._buildRequest(
      "music.userrelation.follow.UserFollowList",
      "GetUserFollowList",
      {
        HostUin: String(uin),
        PageNum: page,
        Num: num,
        From: 0,
        NeedTotal: 1,
        Order: 0,
      },
    );
  }

  /** 获取粉丝列表 */
  getUserFans(uin, page = 1, num = 30) {
    return this._buildRequest(
      "music.userrelation.fans.UserFansList",
      "GetUserFansList",
      {
        HostUin: String(uin),
        PageNum: page,
        Num: num,
        From: 0,
        NeedTotal: 1,
        Order: 0,
      },
    );
  }

  /** 关注 / 取消关注 */
  follow(uin, follow = true) {
    return this._buildRequest(
      "music.userrelation.follow.FollowOperation",
      "Follow",
      {
        HostUin: String(uin),
        op: follow ? 1 : 2,
      },
      { requireLogin: true },
    );
  }
}
