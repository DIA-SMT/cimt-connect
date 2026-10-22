import { useId, useState } from "react";
import { Eye, EyeOff, Gamepad2, Plus, Trash2, TriangleAlert, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectClass } from "../fields";
import {
  type ActivitySpec, type BalloonSpec, type PoemScheme, type PoemSpec, type ReadingSpec, type RhymeCard, type RhymeSpec,
  ACTIVITY_LIMITS as AL, BLANK, MECHANICS, MECHANIC_HINT, MECHANIC_LABEL, POEM_SCHEMES, SCHEME_LABEL, SCHEME_LINES,
  mechanicAllowed, validateActivity,
} from "@/lib/activitySpec";
import { PACE_LABEL, READING_PACES, type ReadingPace, pacePhrase } from "@/lib/speechGames";
import { pictureFor, picturesIn } from "@/lib/wordPictures";
import { ACTIVITY_MIN_AGE, activityAgeOk, activityWarnings, emptyActivity, poemFromText } from "@/lib/activityMechanics";
import { type IconId, ICON_IDS, ICON_LABEL, THEME_IDS, THEME_LABEL, type ThemeId } from "@/lib/activityAssets";
import { RHYME_KINDS, type RhymeKind } from "@/lib/rhymeEs";
import { APPROACH_LABEL, type Approach, type ScreenMode } from "@/lib/practiceRules";
import { Activity } from "@/components/activity/Activity";
import { useSpeech } from "@/components/portal/useSpeech";

// "Para jugar en el celular" (etapa "activities"): la actividad de un
// ejercicio, cargada a mano (fase 1). Es optativa: los pasos del ejercicio
// son la versión sin pantalla. La vista previa usa el mismo componente que
// la familia. Los avisos de rima nunca bloquean (la rima se mide con una
// aproximación); lo que falta completar sí impide guardar. Cada juego se
// ofrece solo en los enfoques que le corresponden (MECHANIC_APPROACHES).

const PILL_BTN = "h-8 rounded-full";
const WARN_BOX = "rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]";
const ERROR_TEXT = "text-[oklch(0.48_0.19_25)]";
const RHYME_KIND_LABEL: Record<RhymeKind, string> = {
  asonante: "Asonante (riman las vocales: «casa» y «mañana»)",
  consonante: "Consonante (riman todos los sonidos: «canción» y «corazón»)",
};

export function ActivityEditor({ activity, exerciseTitle, age, approach, screenMode, onChange }: {
  activity: ActivitySpec | null;
  exerciseTitle: string;
  age: number | null;
  approach: Approach;
  screenMode: ScreenMode;
  onChange: (a: ActivitySpec | null) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const pasteId = useId();

  if (!activity) {
    return (
      <section className="space-y-2 rounded-xl border border-dashed border-border p-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Gamepad2 className="h-4 w-4" aria-hidden="true" /> Para jugar en el celular <span className="font-normal text-muted-foreground">(opcional)</span>
        </h4>
        {!activityAgeOk(age) ? (
          <p className="text-xs text-muted-foreground">Desde los {ACTIVITY_MIN_AGE} años. Hasta entonces, el ejercicio se hace sin pantalla.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              La familia elige entre jugarlo en el celular o hacer los pasos sin pantalla. Terminar el juego no anota la práctica: la anotan como siempre.
            </p>
            <div className="flex flex-wrap gap-2">
              {MECHANICS.filter((m) => mechanicAllowed(m, approach)).map((m) => (
                <Button key={m} type="button" size="sm" variant="outline" className={PILL_BTN} title={MECHANIC_HINT[m]}
                  onClick={() => onChange(emptyActivity(m, exerciseTitle))}>
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {MECHANIC_LABEL[m]}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" className={PILL_BTN} aria-expanded={pasting} onClick={() => setPasting((x) => !x)}>
                <Wand2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Convertir una poesía escrita
              </Button>
            </div>
            {pasting && (
              <div className="space-y-1.5">
                <Label htmlFor={pasteId}>Pegá o escribí la poesía: un verso por renglón y una línea en blanco entre estrofas</Label>
                <Textarea id={pasteId} rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} />
                <Button type="button" size="sm" className={PILL_BTN} disabled={!pasted.trim()}
                  onClick={() => { onChange(poemFromText(pasted, exerciseTitle)); setPasting(false); setPasted(""); }}>
                  Convertir en poesía interactiva
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    );
  }

  return <FilledEditor activity={activity} age={age} approach={approach} screenMode={screenMode} onChange={onChange} />;
}

function FilledEditor({ activity, age, approach, screenMode, onChange }: {
  activity: ActivitySpec;
  age: number | null;
  approach: Approach;
  screenMode: ScreenMode;
  onChange: (a: ActivitySpec | null) => void;
}) {
  const [preview, setPreview] = useState(false);
  const speech = useSpeech("equipo");
  const ids = { title: useId(), theme: useId() };
  const checked = validateActivity(activity);
  const warnings = checked.ok ? activityWarnings(checked.value) : [];
  const set = (patch: Partial<ActivitySpec>) => onChange({ ...activity, ...patch } as ActivitySpec);

  return (
    <section className="space-y-3 rounded-xl border border-primary/30 bg-[color:var(--primary-soft)]/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Gamepad2 className="h-4 w-4" aria-hidden="true" /> Para jugar en el celular: {MECHANIC_LABEL[activity.mecanica]}
        </h4>
        <Button type="button" size="sm" variant="ghost" className={PILL_BTN} onClick={() => onChange(null)}>
          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Quitar la actividad
        </Button>
      </div>
      {!activityAgeOk(age) && (
        <p className={`text-xs font-semibold ${ERROR_TEXT}`}>Las actividades son desde los {ACTIVITY_MIN_AGE} años: quitala para poder guardar.</p>
      )}
      {!mechanicAllowed(activity.mecanica, approach) && (
        <p className={`text-xs font-semibold ${ERROR_TEXT}`}>Este juego no corresponde al enfoque «{APPROACH_LABEL[approach]}»: quitalo o cambiá el enfoque para poder guardar.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={ids.title}>Título del juego</Label>
          <Input id={ids.title} value={activity.titulo} maxLength={AL.titulo} onChange={(e) => set({ titulo: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.theme}>Escenario</Label>
          <select id={ids.theme} className={selectClass} value={activity.tema} onChange={(e) => set({ tema: e.target.value as ThemeId })}>
            {THEME_IDS.map((t) => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}
          </select>
        </div>
      </div>

      {activity.mecanica === "poesia" && <PoemFields poem={activity} onChange={onChange} />}
      {activity.mecanica === "rima" && <RhymeFields spec={activity} onChange={onChange} />}
      {activity.mecanica === "globo" && <BalloonFields spec={activity} onChange={onChange} />}
      {activity.mecanica === "lectura" && <ReadingFields spec={activity} onChange={onChange} />}

      {!checked.ok && <p role="status" className={`text-xs font-semibold ${ERROR_TEXT}`}>Para guardar: {checked.error}</p>}
      {warnings.length > 0 && (
        <div className={WARN_BOX}>
          <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert className="h-4 w-4" aria-hidden="true" /> Para revisar (no impide guardar)</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </div>
      )}

      <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={!checked.ok} aria-expanded={preview}
        onClick={() => { speech.stop(); setPreview((x) => !x); }}>
        {preview ? <EyeOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        {preview ? "Cerrar la vista previa" : "Ver cómo la juega la familia"}
      </Button>
      {preview && checked.ok && (
        <div className="mx-auto w-full max-w-[380px] rounded-[2rem] border-4 border-foreground/10 bg-background p-3">
          {/* Cada cambio vuelve a empezar la vista previa */}
          <Activity key={JSON.stringify(checked.value)} spec={checked.value} screenMode={screenMode} speech={speech}
            finishArea={<p className="text-sm text-muted-foreground">Acá la familia ve «Ya lo hicimos» para anotar la práctica.</p>} />
        </div>
      )}
    </section>
  );
}

function IconSelect({ value, label, onChange }: { value: IconId | null; label: string; onChange: (v: IconId | null) => void }) {
  return (
    <select className={`${selectClass} h-9 w-auto`} aria-label={label} value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as IconId | null)}>
      <option value="">Sin dibujo</option>
      {ICON_IDS.map((i) => <option key={i} value={i}>{ICON_LABEL[i]}</option>)}
    </select>
  );
}

function PoemFields({ poem, onChange }: { poem: PoemSpec; onChange: (a: ActivitySpec) => void }) {
  const ids = { scheme: useId(), kind: useId() };
  const fixed = SCHEME_LINES[poem.esquema];
  const set = (patch: Partial<PoemSpec>) => onChange({ ...poem, ...patch });
  const setStanza = (i: number, versos: string[], icono = poem.estrofas[i].icono) =>
    set({ estrofas: poem.estrofas.map((e, j) => (j === i ? { versos, icono } : e)) });

  function setScheme(s: PoemScheme) {
    const n = SCHEME_LINES[s];
    // Con un esquema fijo, cada estrofa pasa a tener sus versos (sin perder los escritos)
    const estrofas = n === null ? poem.estrofas
      : poem.estrofas.map((e) => ({ ...e, versos: e.versos.length >= n ? e.versos.slice(0, n) : [...e.versos, ...Array(n - e.versos.length).fill("")] }));
    set({ esquema: s, estrofas });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={ids.scheme}>Rima</Label>
          <select id={ids.scheme} className={selectClass} value={poem.esquema} onChange={(e) => setScheme(e.target.value as PoemScheme)}>
            {POEM_SCHEMES.map((s) => <option key={s} value={s}>{SCHEME_LABEL[s]}</option>)}
          </select>
        </div>
        {poem.esquema !== "libre" && (
          <div className="space-y-1.5">
            <Label htmlFor={ids.kind}>Tipo de rima</Label>
            <select id={ids.kind} className={selectClass} value={poem.rima} onChange={(e) => set({ rima: e.target.value as RhymeKind })}>
              {RHYME_KINDS.map((k) => <option key={k} value={k}>{RHYME_KIND_LABEL[k]}</option>)}
            </select>
          </div>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={poem.palmas} onChange={(e) => set({ palmas: e.target.checked })} />
        <span>Marcar el ritmo con palmas <span className="block text-xs text-muted-foreground">El verso de ahora se ve palabra por palabra, para una palmada en cada una.</span></span>
      </label>
      <ol className="space-y-3">
        {poem.estrofas.map((e, i) => (
          <li key={i} className="space-y-2 rounded-lg bg-background p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Estrofa {i + 1}</p>
              <div className="flex items-center gap-1.5">
                <IconSelect value={e.icono} label={`Dibujo de la estrofa ${i + 1}`} onChange={(icono) => setStanza(i, e.versos, icono)} />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" disabled={poem.estrofas.length <= 1}
                  aria-label={`Quitar la estrofa ${i + 1}`} onClick={() => set({ estrofas: poem.estrofas.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
            {e.versos.map((v, k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground" aria-hidden="true">{k + 1}.</span>
                <Input value={v} maxLength={AL.verso} aria-label={`Estrofa ${i + 1}, verso ${k + 1}`}
                  onChange={(ev) => setStanza(i, e.versos.map((x, j) => (j === k ? ev.target.value : x)))} />
                {fixed === null && (
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" disabled={e.versos.length <= AL.versos_min}
                    aria-label={`Quitar el verso ${k + 1} de la estrofa ${i + 1}`} onClick={() => setStanza(i, e.versos.filter((_, j) => j !== k))}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
            {fixed === null && (
              <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={e.versos.length >= AL.versos_max}
                onClick={() => setStanza(i, [...e.versos, ""])}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Sumar un verso
              </Button>
            )}
          </li>
        ))}
      </ol>
      <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={poem.estrofas.length >= AL.estrofas_max}
        onClick={() => set({ estrofas: [...poem.estrofas, { versos: Array(fixed ?? 2).fill(""), icono: null }] })}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Sumar una estrofa
      </Button>
    </div>
  );
}

function RhymeFields({ spec, onChange }: { spec: RhymeSpec; onChange: (a: ActivitySpec) => void }) {
  const setCard = (i: number, patch: Partial<RhymeCard>) =>
    onChange({ ...spec, tarjetas: spec.tarjetas.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Cada tarjeta: un verso, otro verso con el hueco {BLANK} (mejor al final) y la palabra que rima. Las otras opciones no tienen que rimar.
      </p>
      <ol className="space-y-3">
        {spec.tarjetas.map((c, i) => (
          <li key={i} className="space-y-2 rounded-lg bg-background p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Tarjeta {i + 1}</p>
              <div className="flex items-center gap-1.5">
                <IconSelect value={c.icono} label={`Dibujo de la tarjeta ${i + 1}`} onChange={(icono) => setCard(i, { icono })} />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" disabled={spec.tarjetas.length <= AL.tarjetas_min}
                  aria-label={`Quitar la tarjeta ${i + 1}`} onClick={() => onChange({ ...spec, tarjetas: spec.tarjetas.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <Input value={c.verso} maxLength={AL.linea} placeholder="Mi gato Simón" aria-label={`Tarjeta ${i + 1}: primer verso`}
              onChange={(e) => setCard(i, { verso: e.target.value })} />
            <Input value={c.completar} maxLength={AL.linea} placeholder={`duerme en el ${BLANK}`} aria-label={`Tarjeta ${i + 1}: verso para completar`}
              onChange={(e) => setCard(i, { completar: e.target.value })} />
            <div className="flex flex-wrap items-center gap-2">
              <Input value={c.respuesta} maxLength={AL.palabra} placeholder="sillón" className="w-36" aria-label={`Tarjeta ${i + 1}: la palabra que rima`}
                onChange={(e) => setCard(i, { respuesta: e.target.value })} />
              <span className="text-xs text-muted-foreground">Otras opciones:</span>
              {c.distractores.map((d, k) => (
                <Input key={k} value={d} maxLength={AL.palabra} className="w-28" aria-label={`Tarjeta ${i + 1}: opción que no rima ${k + 1}`}
                  onChange={(e) => setCard(i, { distractores: c.distractores.map((x, j) => (j === k ? e.target.value : x)) })} />
              ))}
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" disabled={c.distractores.length >= AL.distractores_max}
                aria-label={`Sumar una opción a la tarjeta ${i + 1}`} onClick={() => setCard(i, { distractores: [...c.distractores, ""] })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" disabled={c.distractores.length <= AL.distractores_min}
                aria-label={`Quitar una opción de la tarjeta ${i + 1}`} onClick={() => setCard(i, { distractores: c.distractores.slice(0, -1) })}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={spec.tarjetas.length >= AL.tarjetas_max}
        onClick={() => onChange({ ...spec, tarjetas: [...spec.tarjetas, { verso: "", completar: BLANK, respuesta: "", distractores: ["", ""], icono: null }] })}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Sumar una tarjeta
      </Button>
    </div>
  );
}

// El globo: las palabras (o frases cortas) que se dicen con arranque suave
function BalloonFields({ spec, onChange }: { spec: BalloonSpec; onChange: (a: ActivitySpec) => void }) {
  const setWords = (palabras: string[]) => onChange({ ...spec, palabras });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Una palabra o frase corta por paso. Para empezar, palabras que empiezan con vocal (árbol, oso, uva). Con el micrófono, el globo sube con la voz
        y la familia ve cómo arrancó; sin micrófono, tocan «Ya la dijimos». No se graba nada. Si la palabra tiene dibujo, el globo lo lleva.
      </p>
      <ol className="space-y-2">
        {spec.palabras.map((w, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground" aria-hidden="true">{i + 1}.</span>
            <span className="w-7 shrink-0 text-center text-xl" title={pictureFor(w) ? "El dibujo que lleva el globo" : "Sin dibujo"} aria-hidden="true">{pictureFor(w) ?? "·"}</span>
            <Input value={w} maxLength={AL.palabra_voz} placeholder={["árbol", "oso", "uva"][i % 3]} aria-label={`Palabra ${i + 1}`}
              onChange={(e) => setWords(spec.palabras.map((x, j) => (j === i ? e.target.value : x)))} />
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" disabled={spec.palabras.length <= AL.palabras_min}
              aria-label={`Quitar la palabra ${i + 1}`} onClick={() => setWords(spec.palabras.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={spec.palabras.length >= AL.palabras_max}
        onClick={() => setWords([...spec.palabras, ""])}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Sumar una palabra
      </Button>
    </div>
  );
}

// Leer con la tortuga: el ritmo y las frases (con cuánto dura cada una)
function ReadingFields({ spec, onChange }: { spec: ReadingSpec; onChange: (a: ActivitySpec) => void }) {
  const paceId = useId();
  const setPhrases = (frases: string[]) => onChange({ ...spec, frases });
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={paceId}>Ritmo de la tortuga</Label>
        <select id={paceId} className={selectClass} value={spec.ritmo} onChange={(e) => onChange({ ...spec, ritmo: e.target.value as ReadingPace })}>
          {READING_PACES.map((r) => <option key={r} value={r}>{PACE_LABEL[r]}</option>)}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">Una frase por paso. Las palabras se iluminan a ese ritmo y se lee siguiendo a la tortuga.</p>
      <ol className="space-y-2">
        {spec.frases.map((f, i) => {
          const secs = f.trim() ? Math.round(pacePhrase(f, spec.ritmo).total / 1000) : 0;
          return (
            <li key={i} className="space-y-1 rounded-lg bg-background p-2">
              <div className="flex items-start gap-2">
                <span className="w-5 shrink-0 pt-2 text-right text-xs text-muted-foreground" aria-hidden="true">{i + 1}.</span>
                <Textarea rows={2} value={f} maxLength={AL.frase} placeholder="La tortuga camina despacito por el campo." aria-label={`Frase ${i + 1}`}
                  onChange={(e) => setPhrases(spec.frases.map((x, j) => (j === i ? e.target.value : x)))} />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" disabled={spec.frases.length <= AL.frases_min}
                  aria-label={`Quitar la frase ${i + 1}`} onClick={() => setPhrases(spec.frases.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
              {secs > 0 && (
                <p className="pl-7 text-xs text-muted-foreground">
                  Con la tortuga: unos {secs} segundos.{picturesIn(f).length > 0 && <> Dibujos: <span className="text-base">{picturesIn(f).join(" ")}</span></>}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={spec.frases.length >= AL.frases_max}
        onClick={() => setPhrases([...spec.frases, ""])}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Sumar una frase
      </Button>
    </div>
  );
}
