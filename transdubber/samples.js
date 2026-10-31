/* =========================================================================
   TransDubber project page — audio sample manifest
   -------------------------------------------------------------------------
   HOW TO ADD A SAMPLE
   1. Put files under  audio/<system-key>/<sample-id>.wav
      e.g.  audio/source/common_voice_en_15304.wav
            audio/transdubber/common_voice_en_15304.wav
      (flac/mp3/m4a/ogg also work if ffmpeg is installed, but the file must be
       named exactly <sample-id>.<ext>: make_spectrograms.py discovers clips by
       that name and does not read any "file" field from this manifest)
   2. Fill in the text fields. In src_text, write a source pause as the
      literal marker <pause>; the page renders it as a pause chip.
      ref_text (reference translation) is optional. Empty strings are hidden.
   3. Run  python3 make_spectrograms.py  to pre-render the spectrogram strips
      (spec/<system>/<id>.png), the timing metadata (spec/meta.js) and the
      audio bundles (spec/audio/<id>.js) that the page plays from.
   4. Toggle systems on/off with "enabled". Order here = order on the page.
      One numbered button per sample; the page shows one sample at a time.
   ========================================================================= */

window.DEMO_SYSTEMS = [
  { key: "source",      label: "English source",   role: "source",   enabled: true },
  { key: "transdubber", label: "TransDubber",      role: "ours",     enabled: true },
  { key: "seamless-l",  label: "Seamless-L",       role: "baseline", enabled: true },
  { key: "seamless-ex", label: "Seamless-Ex",      role: "baseline", enabled: true },
  { key: "qwen-omni",   label: "Qwen2.5-Omni-7B",  role: "baseline", enabled: true },
  { key: "uniss",       label: "UniSS",            role: "baseline", enabled: true },
  { key: "cascaded",    label: "Cascaded",         role: "baseline", enabled: true,
    note: "Qwen3-ASR-1.7B → Hy-MT2-30B-A3B → VoxCPM2" }
];

window.DEMO_SAMPLES = [
  {
    id: "common_voice_en_15304",
    dataset: "CoVoST2 · read speech",
    src_text: "One man and a woman sitting on a table in a restaurant eating dinner.",
    ref_text: "",
    outputs: {
      transdubber:  { text: "一个男人和一个女人并肩而坐，两人坐在餐厅的桌旁吃晚餐。" },
      uniss:        { text: "一名男子和一名坐在餐厅的桌子旁吃晚餐。" },
      cascaded:     { text: "一个男人和一个女人坐在餐厅的桌旁吃完饭。" },
      "qwen-omni":  { text: "一个男人和一个女人坐在餐厅的桌子旁吃晚餐。" },
      "seamless-ex":{ text: "一个男人和一个女人坐在餐厅的桌子上吃晚餐。" },
      "seamless-l": { text: "一个男人和一个女人坐在餐厅的桌子上吃晚餐时。" }
    }
  },
  {
    id: "common_voice_en_176848",
    dataset: "CoVoST2 · read speech",
    src_text: "Many of the reviews in this app-store are faked by bots to manipulate the ranking.",
    ref_text: "这个应用商店中的许多评论都是由机器人伪造的，用来操纵排名的。",
    outputs: {
      transdubber:  { text: "这个应用商店里的评价大多都是假的，用机器人来操控排名。" },
      uniss:        { text: "这个应用商店中的许多评论都是假的，是机器人操纵排名。" },
      cascaded:     { text: "这个应用商店里的很多评论都是机器人伪造的，目的是操纵排名。" },
      "qwen-omni":  { text: "这个应用商店里的很多评论都是由机器人伪造的，以操纵排名。" },
      "seamless-ex":{ text: "这个应用商店的许多评论都是被机器人伪造的，用来操纵排名。" },
      "seamless-l": { text: "该应用商店的许多评论都是机器人伪造的，以操纵排名值。" }
    }
  },
  {
    id: "POD1000000044_S0000189",
    dataset: "GigaSpeech · spontaneous speech",
    src_text: "This is the question that's been nagging at John and Rachel's since they found the report how could this have happened and so John and Rachel want to find Joyce and ask her.",
    ref_text: "自从发现那份报告以来，这个问题就一直困扰着约翰和蕾切尔：怎么会发生这种事？所以，约翰和蕾切尔想找到乔伊斯问问她。",
    outputs: {
      transdubber:  { text: "自从他们发现了报告，这个问题就一直萦绕在他们心头。怎么会发生这种事？于是，约翰和瑞秋决定去找乔伊斯问问。" },
      uniss:        { text: "这是自从约翰和雷切尔发现报告后，一直困扰他们的问题。这怎么会发生？于是，约翰和雷切尔想要找到乔伊斯，并询问他。" },
      cascaded:     { text: "自从看到那份报告后，这个问题就一直困扰着约翰和瑞秋。这种事怎么会发生呢？于是，约翰和瑞秋决定去找乔伊斯问问他。" },
      "qwen-omni":  { text: "这是自从约翰和瑞秋发现那份报告以来，一直困扰着他们的一个问题。他们想知道这是怎么发生的呢？所以，约翰和瑞秋想找到乔伊斯，问他。" },
      "seamless-ex":{ text: "这是约翰和雷切尔发现这份报告后一直困扰着的问题。这怎么可能发生呢？所以，约翰和雷切尔想找乔伊斯问他。" },
      "seamless-l": { text: "这是约翰和雷切尔发现报告后一直困扰着的问题。这是怎么可能发生的呢？所以约翰和雷切尔想找到乔伊斯，问他主。" }
    }
  },
  {
    id: "POD1000000044_S0000120",
    dataset: "GigaSpeech · spontaneous speech",
    src_text: "Nevertheless, a few years later John asked once again if he could come visit by this point Rachel was eighteen and no longer living with Alvin.",
    ref_text: "尽管如此，几年后约翰再次询问他能否来探望，而此时瑞秋已经十八岁，不再和阿尔文住在一起了。",
    outputs: {
      transdubber:  { text: "不过几年后，约翰又提出能否去他家做客。这时，瑞秋已经十八岁，也不再和阿尔文同住。" },
      uniss:        { text: "然而几年后，约翰再次问是否可以来拜访。到那时，雷切尔已经十八岁了，并且不再和阿尔文同住。" },
      cascaded:     { text: "然而，几年后，约翰又问能否来探望。那时，雷切尔已经十八岁，不再和阿尔文住在一起了。" },
      "qwen-omni":  { text: "然而，几年后，约翰再次问是否可以来拜访。到那时，瑞秋已经十八岁了，不再和阿尔芬住在一起了。" },
      "seamless-ex":{ text: "几年后，约翰再次问他是否可以来拜访。当时雷切尔已经十八岁了，不再和阿尔文住在一起了。天。" },
      "seamless-l": { text: "尽管如此，几年后，约翰再次问他是否可以来拜访。来到这时，雷切尔已经十八岁，不再和阿尔文住在一起了。" }
    }
  },
  {
    id: "common_voice_en_19732787",
    dataset: "CoVoST2 · read speech",
    src_text: "Subdivisions have continued through to today, giving Whitehaven a very eclectic housing character.",
    ref_text: "细分业务一直延续到今天，使 Whitehaven 具有非常不拘一格的住房特征。",
    outputs: {
      transdubber:  { text: "这些社区的划分至今仍未结束，使得白黑文的住宅风格极为多元。" },
      uniss:        { text: "这样的划分一直持续到今天，使怀特黑文成为一个非常经典的住宅区。" },
      cascaded:     { text: "直至今天，分区开发仍在进行，使得怀特黑文的住房风格极为多样化。" },
      "qwen-omni":  { text: "分区一直持续到今天，使怀特黑文的住房特色变得非常独特。" },
      "seamless-ex":{ text: "丁天的分区仍然存在，使百天成为一个非常多元化的住房。" },
      "seamless-l": { text: "气氛一直持续到今天，给白天宫一个非常多元化的住房特征。" }
    }
  }
];
