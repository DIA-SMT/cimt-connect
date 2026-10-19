// Rima en español (actividades interactivas, mecánicas «poesia» y «rima»).
// Puro y sin alias de imports: lo usan el panel, el servidor, el portal, el
// mock y las pruebas.
//
// La rima se mide desde la vocal tónica de la última palabra del verso:
//   - consonante: todos los sonidos desde la vocal tónica («canción» y
//     «corazón»: «on»). Se compara cómo suena en el habla de acá: b y v, s,
//     z y c (ante e, i), ll e y, y la h no suena.
//   - asonante: solo las vocales desde la tónica, sin las débiles de los
//     diptongos («dinosaurio» y «canario»: a-o). En las esdrújulas no cuenta
//     la vocal del medio («pájaro»: a-o).
// La vocal tónica sale de las reglas de acentuación: la tilde manda; si no
// hay, las palabras que terminan en vocal, n o s son graves y las demás,
// agudas. Es una aproximación (no conoce las excepciones ni los extranjerismos):
// por eso lo que mide se muestra como aviso y no bloquea.

const ACCENTED: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u" };
const STRONG = new Set(["a", "e", "o", "á", "é", "ó", "í", "ú"]); // la tilde en i o u la hace hiato
const VOWELS = new Set(["a", "e", "i", "o", "u", "á", "é", "í", "ó", "ú", "ü"]);

const plain = (s: string) => s.replace(/[áéíóúü]/g, (c) => ACCENTED[c] ?? c);

// La última palabra de un verso (sin signos), en minúsculas. "" si no hay
export function lastWord(text: string): string {
  const words = String(text ?? "").toLowerCase().match(/[a-záéíóúüñ]+/g);
  return words ? words[words.length - 1] : "";
}

type Nucleus = { vowels: number[] }; // posiciones de las vocales del núcleo, en orden

// ¿La letra de la posición i suena como vocal? La u de «que», «qui», «gue» y
// «gui» no suena; la y final después de vocal («rey», «hoy») es una i
function isVowelAt(w: string, i: number): boolean {
  const c = w[i];
  if (c === "y") return i === w.length - 1 && i > 0 && VOWELS.has(w[i - 1]);
  if (!VOWELS.has(c)) return false;
  if (c === "u" && i > 0 && (w[i - 1] === "q" || w[i - 1] === "g") && "eiéí".includes(w[i + 1] ?? "")) return false;
  return true;
}

// Núcleos de las sílabas: vocales seguidas que no hacen hiato (dos fuertes, o
// una débil con tilde junto a otra vocal, van en sílabas distintas)
function nuclei(w: string): Nucleus[] {
  const out: Nucleus[] = [];
  let cur: number[] = [];
  for (let i = 0; i < w.length; i++) {
    if (!isVowelAt(w, i)) {
      if (cur.length) out.push({ vowels: cur });
      cur = [];
      continue;
    }
    const prev = cur.length ? w[cur[cur.length - 1]] : null;
    if (prev !== null && STRONG.has(prev) && STRONG.has(w[i])) {
      out.push({ vowels: cur });
      cur = [];
    }
    cur.push(i);
  }
  if (cur.length) out.push({ vowels: cur });
  return out;
}

// La vocal que lleva el peso del núcleo: la que tiene tilde, si no la fuerte,
// y si las dos son débiles («ui», «iu»), la segunda
function mainVowel(w: string, n: Nucleus): number {
  const accented = n.vowels.find((i) => "áéíóú".includes(w[i]));
  if (accented !== undefined) return accented;
  const strong = n.vowels.find((i) => STRONG.has(w[i]));
  return strong ?? n.vowels[n.vowels.length - 1];
}

function stressedIndex(w: string, ns: Nucleus[]): number {
  const withTilde = ns.findIndex((n) => n.vowels.some((i) => "áéíóú".includes(w[i])));
  if (withTilde >= 0) return withTilde;
  if (ns.length === 1) return 0;
  const last = w[w.length - 1];
  const grave = "aeiou".includes(last) || last === "n" || last === "s";
  return grave ? ns.length - 2 : ns.length - 1;
}

// Cómo suena (para comparar la rima consonante)
function sound(s: string): string {
  // «gu» y «qu» antes que plain: la ü de «güe» sí suena
  const t = s.replace(/qu(?=[eiéí])/g, "k").replace(/gu(?=[eiéí])/g, "g");
  return plain(t)
    .replace(/h/g, "")
    .replace(/c(?=[ei])/g, "s")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/ll/g, "y")
    .replace(/y$/, "i");
}

export type RhymeKey = { word: string; consonante: string; asonante: string };

// La terminación de un verso o de una palabra. null si no hay palabra
export function rhymeKey(text: string): RhymeKey | null {
  const w = lastWord(text);
  if (!w) return null;
  const ns = nuclei(w);
  if (!ns.length) return null;
  const s = stressedIndex(w, ns);
  const from = mainVowel(w, ns[s]);
  let after = ns.slice(s + 1).map((n) => plain(w[mainVowel(w, n)]));
  if (after.length >= 2) after = [after[after.length - 1]]; // esdrújulas: no cuenta la del medio
  return {
    word: w,
    consonante: sound(w.slice(from)),
    asonante: [plain(w[from]), ...after].join("-"),
  };
}

export const RHYME_KINDS = ["consonante", "asonante"] as const;
export type RhymeKind = (typeof RHYME_KINDS)[number];

export type RhymeCheck = "rima" | "no_rima" | "misma_palabra" | "sin_palabra";

// ¿Riman dos versos? La consonante también vale como asonante
export function rhymeOf(a: string, b: string, kind: RhymeKind): RhymeCheck {
  const ka = rhymeKey(a);
  const kb = rhymeKey(b);
  if (!ka || !kb) return "sin_palabra";
  if (ka.word === kb.word) return "misma_palabra";
  return ka[kind] === kb[kind] ? "rima" : "no_rima";
}

export const rhymes = (a: string, b: string, kind: RhymeKind = "asonante") => rhymeOf(a, b, kind) === "rima";
