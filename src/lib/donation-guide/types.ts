// The donation guide as one JSON document. This is what the editor saves,
// what the store keeps, what the public page renders and what the chatbot
// reads. No HTML anywhere: text, a bold flag and a link address are the only
// things an inline can carry, so nothing pasted into the editor can reach
// the page as markup. validate.ts is the only way in for untrusted input.

export interface Inline {
  text: string
  bold?: true
  /** http(s) URL, or a site path starting with '/'. */
  href?: string
}

export interface ParagraphBlock {
  type: 'paragraph'
  inlines: Inline[]
}

export interface ListBlock {
  type: 'bullets' | 'numbers'
  items: Inline[][]
}

export type Block = ParagraphBlock | ListBlock

export interface RichText {
  blocks: Block[]
}

export interface Section {
  id: string
  /** The "If you have" label: "5 minutes–1 hour". */
  time: string
  body: RichText
}

export interface Tab {
  id: string
  /** The tab label, also the heading: "$1–1,000" reads "$1–1,000 donation". */
  amount: string
  /** The one-line paragraph under the heading. */
  lead: string
  sections: Section[]
}

export interface Guide {
  /** The sentence under the page title. One paragraph; bold reads as the
   *  light-teal highlight. */
  intro: RichText
  tabs: Tab[]
}

/** Who did something, as recorded on drafts and versions. */
export interface Actor {
  name: string
  email: string
}

export interface LiveDoc {
  /** 1 for the first publish; the seed in the code counts as 0. */
  version: number
  guide: Guide
  publishedAt: string
  publishedBy: Actor
  /** "Restored version 3", or absent for an ordinary publish. */
  note?: string
}

export interface DraftDoc {
  guide: Guide
  savedAt: string
  savedBy: Actor
  /** The live version the draft was started from. */
  basedOn: number
}

export type VersionMeta = Omit<LiveDoc, 'guide'>

export const LIMITS = {
  tabs: 8,
  sections: 8,
  introBlocks: 1,
  blocksPerSection: 60,
  itemsPerList: 60,
  inlinesPerBlock: 200,
  inlineText: 2000,
  amount: 40,
  lead: 400,
  time: 60,
  href: 2048,
  id: 60,
  totalBytes: 250_000,
} as const
