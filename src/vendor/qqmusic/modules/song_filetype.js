/**
 * 歌曲文件类型枚举.
 */

export class SongFileType {
  constructor(code, ext, label) {
    this.code = code;
    this.ext = ext;
    this.label = label;
  }

  static DTS_X = new SongFileType("DT03", ".mp4", "DTS:X");
  static MASTER = new SongFileType("AI00", ".flac", "臻品母带");
  static ATMOS_2 = new SongFileType("Q000", ".flac", "臻品音质");
  static ATMOS_51 = new SongFileType("Q001", ".flac", "臻品全景声 5.1");
  static ATMOS_71 = new SongFileType("Q003", ".ogg", "臻品全景声 7.1");
  static ATMOS_DB = new SongFileType("D004", ".mp4", "杜比全景声");
  static NAC = new SongFileType("TL01", ".nac", "腾讯自研 AICodec");
  static FLAC = new SongFileType("F000", ".flac", "SQ 无损");
  static OGG_640 = new SongFileType("O801", ".ogg", "OGG 640");
  static OGG_320 = new SongFileType("O800", ".ogg", "OGG 320");
  static OGG_192 = new SongFileType("O600", ".ogg", "OGG 192");
  static OGG_96 = new SongFileType("O400", ".ogg", "OGG 96");
  static MP3_320 = new SongFileType("M800", ".mp3", "MP3 320");
  static MP3_128 = new SongFileType("M500", ".mp3", "MP3 128");
  static ACC_192 = new SongFileType("C600", ".m4a", "ACC 192");
  static ACC_96 = new SongFileType("C400", ".m4a", "ACC 96");
  static ACC_48 = new SongFileType("C200", ".m4a", "ACC 48");
}

const CODE_MAP = {};
for (const k of Object.keys(SongFileType)) {
  const v = SongFileType[k];
  if (v instanceof SongFileType) CODE_MAP[v.code] = v;
}

/** 根据 code 字符串还原枚举(找不到时返回 undefined) */
export function parseSongFileType(code) {
  return CODE_MAP[code];
}
