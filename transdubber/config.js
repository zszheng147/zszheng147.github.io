/* =========================================================================
   TransDubber project page — fill in once, the page reads these values.
   -------------------------------------------------------------------------
   - authors / affiliations: shown under the title. `affil` lists the indices
     (1-based) into `affiliations`. Set `equal: true` for shared first authors
     and `corresponding: true` for the contact author.
   - links: one button each. Leave `url` empty ("") to render the button as
     "coming soon"; delete an entry to remove the button entirely.
   - bibtex: shown verbatim in the "Citation" section.
   ========================================================================= */

window.PAGE_CONFIG = {
  authors: [
    /* `url` = homepage; `equal: true` marks shared first authors, `corresponding: true` the contact author */
    { name: "Zhisheng Zheng", url: "https://zhishengzheng.com/",   affil: [1] },
    { name: "David Harwath",  url: "http://cs.utexas.edu/~harwath", affil: [1] }
  ],
  affiliations: [
    "The University of Texas at Austin"
  ],

  links: [
    { label: "arXiv",       icon: "arxiv",  url: "" },   /* https://arxiv.org/abs/XXXX.XXXXX */
    { label: "Code",        icon: "code",   url: "https://github.com/zszheng147/TransDubber" },
    { label: "Training Data", icon: "data", url: "" },
    { label: "Testset",       icon: "data", url: "https://huggingface.co/datasets/zhisheng01/TransDubber-testset" },
    { label: "Models",      icon: "model",  url: "https://huggingface.co/zhisheng01/TransDubber" }
  ],

  bibtex: [
    "@article{transdubber2026,",
    "  title   = {Learning Timeline-Preserving Speech-to-Speech Translation},",
    "  author  = {Zheng, Zhisheng and Harwath, David},",
    "  journal = {arXiv preprint arXiv:XXXX.XXXXX},",
    "  year    = {2026}",
    "}"
  ].join("\n")
};
