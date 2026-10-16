// Variable-order Markov chain text generator.
//
// Every message is stored as one flat stream of token ids, with a BOUNDARY token
// between messages: [B, hi, there, B, how, are, you, B, ...]
// For every (normalized) word we keep the list of positions where it occurs.
//
// To pick the next word given the last k words, we find every position in the
// stream where those k words occur (scanning the position list of the rarest of
// them) and pick one of those occurrences uniformly at random; the word right
// after it is the next word. That is exactly sampling from the order-k n-gram
// distribution, but works for any k without storing separate n-gram tables,
// and the same index works backward too.
//
// Generation tries the highest order first and backs off to shorter contexts
// when needed. To avoid simply reciting existing messages, it tracks how many
// tokens in a row were copied from one place in the corpus and, past a limit,
// prefers continuations from somewhere else.

const BOUNDARY = 0

const DEFAULTS = {
  from: '',          // words the result should start with (or end with, if backward)
  backward: false,   // generate towards the start of a message instead of the end
  order: 'auto',     // max number of previous words used as context; 'auto' picks by corpus size
  minWords: 3,       // avoid ending the message before this many words (if possible)
  targetWords: 25,   // past this length, end the message as soon as a natural ending comes up
  maxWords: 50,      // hard cap on output length
  maxCopy: 6,        // after this many words copied in a row from one message, try to branch off
  tries: 10          // attempts at producing something that isn't a verbatim existing message
}

// Wrapping characters that don't change what a word means in context. Sentence
// punctuation (. ! ? ...) is kept, so "band." and "band" are different contexts.
const WRAPPING = /^["'`(\[{*_~“”‘’]+|["'`)\]}*_~“”‘’,;]+$/g

/**
 * Normalized form of a word, used for matching contexts ("Hello" and "hello" match,
 * as do "*this*" and "this"). The original spelling is still what ends up in the output.
 */
const normalize = word => {
  const lower = word.toLowerCase().replace(/’/g, '\'')
  const stripped = lower.replace(WRAPPING, '')
  return stripped || lower
}

const tokenize = text => text.split(/\s+/).filter(Boolean)

class MarkovChain {

  /**
   * @param {string} [text] - Optional training text, one message per line.
   */
  constructor(text) {
    this.surfaceIds = new Map()   // surface word -> surface id
    this.surfaces = ['']          // surface id -> surface word
    this.normIds = new Map()      // normalized word -> norm id
    this.normOf = [BOUNDARY]      // surface id -> norm id

    this.tokens = new Int32Array(1024) // the stream, as surface ids
    this.length = 0
    this._push(BOUNDARY)

    // Positions of each norm id. Bulk-loaded data lives in a compact CSR layout
    // (postStart/postData); words added afterwards go into `recent`.
    this.postStart = new Int32Array(2)
    this.postData = new Int32Array(0)
    this.recent = new Map()       // norm id -> number[]

    this.messageCount = 0

    if (text) {
      for (const line of text.split('\n')) this._add(line)
      this.compact()
    }
  }

  /**
   * Learn a message. Multi-line messages are learnt as separate lines,
   * consistent with how the server text files are stored.
   *
   * @param {string} text
   */
  update(text) {
    if (typeof text !== 'string') throw 'The argument should be a string'
    for (const line of text.split('\n')) {
      const start = this.length
      if (!this._add(line)) continue
      for (let p = start; p < this.length; p++) {
        const id = this.normOf[this.tokens[p]]
        let list = this.recent.get(id)
        if (!list) this.recent.set(id, list = [])
        list.push(p)
      }
    }
  }

  /**
   * Whether a word (compared in normalized form) has been learnt.
   *
   * @param {string} word
   */
  contains(word) {
    return this.normIds.has(normalize(word))
  }

  /**
   * Generate a message. Returns '' if `from` ends in a word the chain doesn't know
   * or there is nothing to generate from.
   *
   * @param {Partial<typeof DEFAULTS>} [config]
   * @return {string}
   */
  generate(config = {}) {
    const cfg = { ...DEFAULTS, ...config }
    // Longer contexts read better but need lots of data, otherwise they just recite messages.
    if (cfg.order === 'auto') cfg.order = this.length > 1500000 ? 3 : 2
    const dir = cfg.backward ? -1 : 1

    // Seed words in generation order
    let seed = tokenize(cfg.from || '')
    if (cfg.backward) seed.reverse()
    seed = seed.slice(-cfg.maxWords)
    const seedIds = seed.map(w => this.normIds.get(normalize(w)) ?? -1)

    if (seedIds.length && seedIds[seedIds.length - 1] === -1) return ''
    if (this.messageCount === 0) return ''

    let best = null

    for (let attempt = 0; attempt < cfg.tries; attempt++) {
      const result = this._generateOnce(seed, seedIds, dir, cfg)
      if (!result) continue
      if (!best || result.score > best.score) best = result
      if (!result.verbatim) break
    }

    if (!best) return ''
    const words = cfg.backward ? best.words.reverse() : best.words
    return words.join(' ')
  }

  /**
   * Re-pack all positions into the compact layout. Called automatically after
   * bulk loading; can be called again occasionally if lots of messages were added.
   */
  compact() {
    const n = this.normIds.size + 1
    const counts = new Int32Array(n + 1)
    for (let p = 0; p < this.length; p++) counts[this.normOf[this.tokens[p]] + 1]++
    for (let i = 1; i <= n; i++) counts[i] += counts[i - 1]

    const data = new Int32Array(this.length)
    const fill = counts.slice(0, n)
    for (let p = 0; p < this.length; p++) data[fill[this.normOf[this.tokens[p]]]++] = p

    this.postStart = counts
    this.postData = data
    this.recent = new Map()
  }

  // ---- internals ----

  _push(id) {
    if (this.length === this.tokens.length) {
      const bigger = new Int32Array(this.tokens.length * 2)
      bigger.set(this.tokens)
      this.tokens = bigger
    }
    this.tokens[this.length++] = id
  }

  _surfaceId(word) {
    let id = this.surfaceIds.get(word)
    if (id === undefined) {
      id = this.surfaces.length
      this.surfaces.push(word)
      this.surfaceIds.set(word, id)

      const norm = normalize(word)
      let normId = this.normIds.get(norm)
      if (normId === undefined) {
        normId = this.normIds.size + 1
        this.normIds.set(norm, normId)
      }
      this.normOf.push(normId)
    }
    return id
  }

  /** Append one line to the stream. Returns false if it had no words. */
  _add(line) {
    const words = tokenize(line)
    if (!words.length) return false
    for (const w of words) this._push(this._surfaceId(w))
    this._push(BOUNDARY)
    this.messageCount++
    return true
  }

  _postingCount(normId) {
    const compactCount = normId + 1 < this.postStart.length
      ? this.postStart[normId + 1] - this.postStart[normId]
      : 0
    const recent = this.recent.get(normId)
    return compactCount + (recent ? recent.length : 0)
  }

  _forEachPosting(normId, fn) {
    if (normId + 1 < this.postStart.length) {
      const end = this.postStart[normId + 1]
      for (let i = this.postStart[normId]; i < end; i++) fn(this.postData[i])
    }
    const recent = this.recent.get(normId)
    if (recent) for (const p of recent) fn(p)
  }

  /** A random position of `normId` that passes `accept`, or -1 if a few tries find none. */
  _samplePosting(normId, dir, accept) {
    const compactStart = normId + 1 < this.postStart.length ? this.postStart[normId] : 0
    const compactCount = normId + 1 < this.postStart.length ? this.postStart[normId + 1] - compactStart : 0
    const recent = this.recent.get(normId) || []
    const total = compactCount + recent.length
    if (!total) return -1

    for (let i = 0; i < 16; i++) {
      const r = Math.floor(Math.random() * total)
      const p = r < compactCount ? this.postData[compactStart + r] : recent[r - compactCount]
      if (p + dir >= 0 && p + dir < this.length && accept(p)) return p
    }
    return -1
  }

  /**
   * All stream positions p (of the context's last word) where `context` (norm ids,
   * in generation order) occurs, reading in direction `dir`, and that have a
   * following token.
   */
  _matches(context, dir) {
    const k = context.length

    // Scan the positions of the rarest word in the context
    let pivot = 0
    let pivotCount = Infinity
    for (let i = 0; i < k; i++) {
      const c = this._postingCount(context[i])
      if (c < pivotCount) { pivot = i; pivotCount = c }
    }
    if (pivotCount === 0) return []

    const out = []
    const { tokens, normOf, length } = this
    const offset = dir * (k - 1 - pivot)

    this._forEachPosting(context[pivot], q => {
      const p = q + offset
      const next = p + dir
      if (next < 0 || next >= length) return
      for (let i = 0; i < k; i++) {
        const at = p - dir * (k - 1 - i)
        if (at < 0 || at >= length || normOf[tokens[at]] !== context[i]) return
      }
      out.push(p)
    })
    return out
  }

  _generateOnce(seed, seedIds, dir, cfg) {
    const words = [...seed]
    // Generation history as norm ids, starting at a message boundary
    const history = [BOUNDARY, ...seedIds]

    let prevPos = -1      // where in the stream the last word was taken from
    let copyRun = 0       // how many words in a row were taken contiguously
    let longestRun = 0
    let branches = 0      // how many times we jumped to a different place in the corpus
    let ended = false

    while (words.length < cfg.maxWords) {
      const pick = this._pickNext(history, prevPos, copyRun, words.length, dir, cfg)
      if (!pick) break

      const { pos } = pick
      if (pos === prevPos && prevPos !== -1) {
        copyRun++
      } else {
        if (prevPos !== -1) branches++
        copyRun = 1
      }
      longestRun = Math.max(longestRun, copyRun)

      const nextPos = pos + dir
      const token = this.tokens[nextPos]
      if (token === BOUNDARY) { ended = true; break }

      words.push(this.surfaces[token])
      history.push(this.normOf[token])
      prevPos = nextPos
    }

    if (words.length === seed.length) return null

    // Is the whole result an existing message? (Ignoring case and edge punctuation.)
    const verbatim = ended && !history.includes(-1) &&
      this._matches([...history, BOUNDARY], dir).length > 0
    const generated = words.length - seed.length
    return {
      words,
      verbatim,
      score: (verbatim ? -1000 : 0) + branches * 2 - longestRun + Math.min(generated, cfg.minWords)
    }
  }

  /**
   * Choose where the next word comes from. Returns { pos } where `pos` is the
   * stream position matching the end of the context; the next word is at pos + dir.
   */
  _pickNext(history, prevPos, copyRun, wordCount, dir, cfg) {
    const maxK = Math.min(cfg.order, history.length)
    const avoidCopy = copyRun >= cfg.maxCopy
    const avoidEnd = wordCount < cfg.minWords
    const wantEnd = wordCount >= cfg.targetWords
    let fallback = null

    for (let k = maxK; k >= 1; k--) {
      const context = history.slice(history.length - k)
      // A context of only a boundary means "start of message", fine.
      // A context containing an unknown seed word can't match; back off.
      if (context.includes(-1)) continue

      if (k === 1) {
        // Every position of the word matches; try a few random ones before scanning them all
        const quick = this._samplePosting(context[0], dir, p =>
          !(avoidCopy && p === prevPos) &&
          !(avoidEnd && this.tokens[p + dir] === BOUNDARY) &&
          !(wantEnd && this.tokens[p + dir] !== BOUNDARY))
        if (quick !== -1) return { pos: quick }
      }

      const matches = this._matches(context, dir)
      if (!matches.length) continue

      if (wantEnd) {
        const ending = matches.find(p => this.tokens[p + dir] === BOUNDARY)
        if (ending !== undefined) return { pos: ending }
      }

      let candidates = matches
      if (avoidCopy) candidates = candidates.filter(p => p !== prevPos)
      if (avoidEnd) candidates = candidates.filter(p => this.tokens[p + dir] !== BOUNDARY)

      if (candidates.length) return { pos: candidates[Math.floor(Math.random() * candidates.length)] }

      // Nothing satisfies our preferences at this order; remember a valid choice
      // from the highest order and see if a shorter context offers alternatives.
      if (!fallback) fallback = { pos: matches[Math.floor(Math.random() * matches.length)] }
    }

    return fallback
  }
}

MarkovChain.normalize = normalize
MarkovChain.DEFAULTS = DEFAULTS

module.exports = MarkovChain
