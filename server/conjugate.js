// Conjugates a Japanese verb given its dictionary (plain) form, reading, and group.
// Covers the MNN "core" form set: ます, ない, た, て, potential, volitional, ば, たら.
//
// Only godan/ichidan/irregular classification comes from AI (server/routes/verbs.js) — the
// actual conjugated forms below are pure rule-based grammar, computed the same way every time,
// so there's no hallucination risk and no per-form API cost.

const FORM_KEYS = ['masu', 'nai', 'ta', 'te', 'potential', 'volitional', 'ba', 'tara'];

// For each godan dictionary-form ending: the -a/-i/-e/-o row kana, and the euphonic (onbin)
// changes used for the た/て forms specifically (these aren't simply "row + た/て").
const GODAN_ROWS = {
  'う': { a: 'わ', i: 'い', e: 'え', o: 'お', ta: 'った', te: 'って' },
  'く': { a: 'か', i: 'き', e: 'け', o: 'こ', ta: 'いた', te: 'いて' },
  'ぐ': { a: 'が', i: 'ぎ', e: 'げ', o: 'ご', ta: 'いだ', te: 'いで' },
  'す': { a: 'さ', i: 'し', e: 'せ', o: 'そ', ta: 'した', te: 'して' },
  'つ': { a: 'た', i: 'ち', e: 'て', o: 'と', ta: 'った', te: 'って' },
  'ぬ': { a: 'な', i: 'に', e: 'ね', o: 'の', ta: 'んだ', te: 'んで' },
  'ぶ': { a: 'ば', i: 'び', e: 'べ', o: 'ぼ', ta: 'んだ', te: 'んで' },
  'む': { a: 'ま', i: 'み', e: 'め', o: 'も', ta: 'んだ', te: 'んで' },
  'る': { a: 'ら', i: 'り', e: 'れ', o: 'ろ', ta: 'った', te: 'って' },
};

function buildForms(masu, nai, ta, te, potential, volitional, ba, tara) {
  return { masu, nai, ta, te, potential, volitional, ba, tara };
}

/**
 * @param {string} dictionaryForm  kanji-mixed or kana dictionary form, e.g. "食べる" or "飲む"
 * @param {string} dictionaryReading  pure kana reading, e.g. "たべる" / "のむ"
 * @param {'ichidan'|'godan'|'irregular'} group
 * @returns {{masu,nai,ta,te,potential,volitional,ba,tara}} kanji-mixed display forms, or null if unrecognized
 */
function conjugate(dictionaryForm, dictionaryReading, group) {
  if (!dictionaryReading) return null;
  const hasKanji = Boolean(dictionaryForm) && dictionaryForm !== dictionaryReading;

  // Irregular: する, and compound verbs ending in する (勉強する, 電話する, ...)
  if (dictionaryReading.endsWith('する')) {
    const kStem = hasKanji ? dictionaryForm.slice(0, -2) : dictionaryReading.slice(0, -2);
    return buildForms(
      kStem + 'します', kStem + 'しない', kStem + 'した', kStem + 'して',
      kStem + 'できる', kStem + 'しよう', kStem + 'すれば', kStem + 'したら'
    );
  }

  // Irregular: 来る. With kanji, the kanji stem "来" stays fixed across every form (来ます,
  // 来ない...) since Japanese doesn't write furigana for the vowel shift in normal text.
  // Without kanji (pure reading), the vowel genuinely changes (ki/ko/ku) and must be spelled out.
  if (dictionaryReading === 'くる') {
    if (hasKanji) {
      const kStem = dictionaryForm.slice(0, -1); // "来る" -> "来"
      return buildForms(
        kStem + 'ます', kStem + 'ない', kStem + 'た', kStem + 'て',
        kStem + 'られる', kStem + 'よう', kStem + 'れば', kStem + 'たら'
      );
    }
    return buildForms('きます', 'こない', 'きた', 'きて', 'こられる', 'こよう', 'くれば', 'きたら');
  }

  const lastChar = dictionaryReading.slice(-1);
  const row = GODAN_ROWS[lastChar];
  if (!row) return null; // not a recognized verb ending

  const readingStem = dictionaryReading.slice(0, -1);
  const kStem = hasKanji ? dictionaryForm.slice(0, -1) : readingStem;

  // 行く is the one common exception to く's usual いた/いて euphonic pattern
  const isIku = dictionaryReading === 'いく';
  const taSuffix = isIku ? 'った' : row.ta;
  const teSuffix = isIku ? 'って' : row.te;

  if (group === 'ichidan') {
    // Drop る, add suffix directly — no euphonic changes for ichidan verbs
    return buildForms(
      kStem + 'ます', kStem + 'ない', kStem + 'た', kStem + 'て',
      kStem + 'られる', kStem + 'よう', kStem + 'れば', kStem + 'たら'
    );
  }

  // Godan. ある is a standard godan verb except its negative is irregular (ない, not あらない).
  const isAru = dictionaryReading === 'ある';
  return buildForms(
    kStem + row.i + 'ます',
    isAru ? 'ない' : kStem + (lastChar === 'う' ? 'わ' : row.a) + 'ない',
    kStem + taSuffix,
    kStem + teSuffix,
    kStem + row.e + 'る',
    kStem + row.o + 'う',
    kStem + row.e + 'ば',
    kStem + taSuffix + 'ら'
  );
}

module.exports = { conjugate, FORM_KEYS };

// --- Adjective / noun conditional conjugation (たら "if", ても "even if") ---
// These share one column set since な-adjectives and nouns both conjugate off the です/だ copula.
const ADJ_NOUN_FORM_KEYS = ['plain', 'negative', 'past', 'tara', 'negativeTara', 'te', 'temo', 'negativeTemo'];

function buildAdjNounForms(plain, negative, past, tara, negativeTara, te, temo, negativeTemo) {
  return { plain, negative, past, tara, negativeTara, te, temo, negativeTemo };
}

/** @param {string} dictionaryForm  e.g. "高い" or "たかい" — must end in い */
function conjugateIAdjective(dictionaryForm) {
  if (!dictionaryForm || !dictionaryForm.endsWith('い')) return null;
  // いい ("good") is the one common irregular い-adjective — it conjugates as よい (よくない, not いくない)
  const isIrregularIi = dictionaryForm === 'いい' || dictionaryForm === '良い';
  const stem = isIrregularIi ? dictionaryForm.slice(0, -2) + 'よ' : dictionaryForm.slice(0, -1);
  return buildAdjNounForms(
    dictionaryForm, stem + 'くない', stem + 'かった', stem + 'かったら',
    stem + 'くなかったら', stem + 'くて', stem + 'くても', stem + 'くなくても'
  );
}

/** @param {string} dictionaryForm  bare stem, no な/だ/です — e.g. "ひま" or "パイロット" */
function conjugateNaAdjectiveOrNoun(dictionaryForm) {
  if (!dictionaryForm) return null;
  // Defensive: strip a trailing な/だ/です if the classifier included it despite instructions
  const stem = dictionaryForm.replace(/(な|だ|です)$/, '');
  return buildAdjNounForms(
    stem + 'だ', stem + 'じゃない', stem + 'だった', stem + 'だったら',
    stem + 'じゃなかったら', stem + 'で', stem + 'でも', stem + 'じゃなくても'
  );
}

/**
 * @param {'i_adjective'|'na_adjective'|'noun'} partOfSpeech
 */
function conjugateAdjNoun(dictionaryForm, partOfSpeech) {
  if (partOfSpeech === 'i_adjective') return conjugateIAdjective(dictionaryForm);
  if (partOfSpeech === 'na_adjective' || partOfSpeech === 'noun') return conjugateNaAdjectiveOrNoun(dictionaryForm);
  return null;
}

module.exports.conjugateAdjNoun = conjugateAdjNoun;
module.exports.ADJ_NOUN_FORM_KEYS = ADJ_NOUN_FORM_KEYS;
