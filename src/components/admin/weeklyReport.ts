// Informe semanal para la Gerencia de Datos (relevamiento, respuesta 38) y
// exportación a Excel de las estadísticas. Usa el mismo cálculo que el tablero.
import { toast } from "sonner";
import { formatShortDate, todayKey } from "@/lib/patients";
import { fmt1, type Row, type Stats } from "@/lib/stats";

const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function rowsTable(title: string, rows: Row[], unit = "Cantidad"): string {
  const live = rows.filter((r) => r.value > 0);
  if (!live.length) return `<h3>${esc(title)}</h3><p class="muted">Sin datos.</p>`;
  return `<h3>${esc(title)}</h3><table><tr><th>${esc(title.split(" por ")[1] ?? "")}</th><th class="n">${unit}</th></tr>${
    live.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.value}</td></tr>`).join("")}</table>`;
}

export function printWeeklyReport(s: Stats, label: string) {
  const a = s.attention;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Informe semanal CIMT — ${esc(label)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  html { color-scheme: light; background: #fff; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a2b3c; font-size: 10.5pt; margin: 0; }
  @media screen { body { max-width: 800px; margin: 24px auto; padding: 0 20px; } }
  header { border-bottom: 2px solid #1d4f7a; padding-bottom: 8px; margin-bottom: 14px; }
  header strong { font-size: 14pt; color: #1d4f7a; }
  header div { font-size: 9pt; color: #55657a; }
  h1 { font-size: 14pt; margin: 0 0 2px; } .sub { color: #55657a; margin: 0 0 12px; }
  h2 { font-size: 11.5pt; color: #1d4f7a; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #d5dde6; padding-bottom: 3px; }
  h3 { font-size: 10pt; margin: 10px 0 4px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .kpi { border: 1px solid #d5dde6; border-radius: 6px; padding: 6px 8px; }
  .kpi b { display: block; font-size: 15pt; color: #1d4f7a; } .kpi span { font-size: 8.5pt; color: #55657a; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 6px; }
  th, td { border: 1px solid #d5dde6; padding: 3px 6px; text-align: left; } th { background: #eef3f8; font-size: 9pt; }
  .n { text-align: right; width: 70px; } .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .muted { color: #7a8899; } footer { margin-top: 18px; font-size: 8.5pt; color: #7a8899; text-align: center; }
</style></head><body>
<header><strong>CIMT — Centro Integral Municipal de Tartamudez</strong>
<div>Municipalidad de San Miguel de Tucumán · Catamarca 411</div></header>
<h1>Informe semanal</h1>
<p class="sub">${esc(label)} · generado el ${esc(formatShortDate(todayKey()))}</p>

<h2>Resumen de la semana</h2>
<div class="kpis">
  <div class="kpi"><b>${s.admissions.count}</b><span>Ingresos (pacientes nuevos)</span></div>
  <div class="kpi"><b>${s.intake.received}</b><span>Solicitudes recibidas</span></div>
  <div class="kpi"><b>${a.practices}</b><span>Prácticas registradas</span></div>
  <div class="kpi"><b>${a.absenteeism === null ? "—" : a.absenteeism + "%"}</b><span>Ausentismo</span></div>
  <div class="kpi"><b>${a.scheduled}</b><span>Turnos programados</span></div>
  <div class="kpi"><b>${s.referrals.count}</b><span>Derivaciones / interconsultas</span></div>
  <div class="kpi"><b>${s.intake.waitMedian === null ? "—" : fmt1(s.intake.waitMedian) + " d"}</b><span>Espera (mediana)</span></div>
  <div class="kpi"><b>${s.satisfaction.overall === null ? "—" : fmt1(s.satisfaction.overall)}</b><span>Satisfacción (1 a 5)</span></div>
</div>

<h2>Atención</h2>
<table><tr><th>Profesional</th><th class="n">Turnos</th><th class="n">Prácticas</th><th class="n">Ausentes</th><th class="n">Justif.</th></tr>
${a.byProfessional.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.scheduled}</td><td class="n">${r.present}</td><td class="n">${r.absent}</td><td class="n">${r.justified}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Sin turnos.</td></tr>`}
<tr><th>Total</th><th class="n">${a.scheduled}</th><th class="n">${a.practices}</th><th class="n">${a.absent}</th><th class="n">${a.justified}</th></tr></table>
<p class="muted">Turnos cancelados: ${a.canceled} · Por telemedicina: ${a.telemed} · Sin marcar asistencia: ${a.unmarked}</p>

<h2>Ingresos</h2>
<div class="cols"><div>${rowsTable("Ingresos por localidad", s.admissions.byLocality)}</div><div>${rowsTable("Ingresos por edad", s.admissions.byAge)}</div></div>
<div class="cols"><div>${rowsTable("Ingresos por obra social", s.admissions.byInsurance)}</div><div>${rowsTable("Ingresos por condición asociada", s.admissions.byCondition)}</div></div>

<h2>Solicitudes y talleres</h2>
<div class="cols"><div>${rowsTable("Solicitudes por estado", s.intake.byStatus)}</div>
<div><h3>Talleres para familias</h3><table>
<tr><td>Talleres realizados</td><td class="n">${s.intake.workshops}</td></tr>
<tr><td>Familias anotadas</td><td class="n">${s.intake.workshopEnrolled}</td></tr>
<tr><td>Familias que asistieron</td><td class="n">${s.intake.workshopAttended}</td></tr>
<tr><td>Espera solicitud → 1ª sesión (promedio)</td><td class="n">${s.intake.waitAvg === null ? "—" : fmt1(s.intake.waitAvg) + " d"}</td></tr>
</table></div></div>

<h2>Derivaciones e interconsultas</h2>
<div class="cols"><div>${rowsTable("Derivaciones por especialidad", s.referrals.bySpecialty)}</div>
<div><h3>Registro</h3><table><tr><td>Registradas</td><td class="n">${s.referrals.registered}</td></tr>
<tr><td>Sin registrar</td><td class="n">${s.referrals.count - s.referrals.registered}</td></tr></table></div></div>

<h2>Satisfacción</h2>
<table><tr><td>Encuestas respondidas</td><td class="n">${s.satisfaction.count}</td></tr>
<tr><td>Calidad de la atención</td><td class="n">${fmt1(s.satisfaction.attention)}</td></tr>
<tr><td>Claridad de las explicaciones</td><td class="n">${fmt1(s.satisfaction.communication)}</td></tr>
<tr><td>Trato del equipo</td><td class="n">${fmt1(s.satisfaction.treatment)}</td></tr>
<tr><td>Satisfacción general</td><td class="n">${fmt1(s.satisfaction.overall)}</td></tr>
<tr><td>Recomendaría el CIMT</td><td class="n">${s.satisfaction.recommend === null ? "—" : s.satisfaction.recommend + "%"}</td></tr></table>

<h2>Situación actual (al ${esc(formatShortDate(todayKey()))})</h2>
<div class="cols"><div><table>
<tr><td>Pacientes registrados</td><td class="n">${s.current.total}</td></tr>
<tr><td>Pacientes activos</td><td class="n">${s.current.active}</td></tr>
<tr><td>Derivaciones pendientes</td><td class="n">${s.current.pendingReferrals}</td></tr></table></div>
<div>${rowsTable("Pacientes por estado del caso", s.current.byStatus)}</div></div>

<footer>Documento de uso interno · datos agregados, sin información personal de pacientes.</footer>
<script>window.onload = () => window.print();</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) { toast.error("El navegador bloqueó la ventana. Permití las ventanas emergentes para este sitio."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function exportStatsCsv(s: Stats, label: string) {
  const a = s.attention;
  const section = (title: string, head: string, rows: Row[]) => [[], [title, head], ...rows.map((r) => [r.name, r.value])];
  const rows: (string | number)[][] = [
    ["Estadísticas CIMT"],
    ["Período", label + (s.range.start ? ` (${s.range.start} a ${s.range.end ?? todayKey()})` : "")],
    ["Generado", todayKey()],
    [],
    ["EN EL PERÍODO"],
    ["Ingresos (pacientes nuevos)", s.admissions.count],
    ["Solicitudes recibidas", s.intake.received],
    ["Turnos programados", a.scheduled],
    ["Prácticas registradas (presentes)", a.practices],
    ["Ausentes", a.absent],
    ["Ausentes justificados", a.justified],
    ["Ausentismo %", a.absenteeism ?? ""],
    ["Turnos cancelados", a.canceled],
    ["Turnos por telemedicina", a.telemed],
    ["Derivaciones e interconsultas", s.referrals.count],
    ["Derivaciones registradas", s.referrals.registered],
    ["Talleres realizados", s.intake.workshops],
    ["Familias anotadas a talleres", s.intake.workshopEnrolled],
    ["Familias que asistieron", s.intake.workshopAttended],
    ["Espera solicitud a 1ª sesión, mediana (días)", s.intake.waitMedian ?? ""],
    ["Espera solicitud a 1ª sesión, promedio (días)", s.intake.waitAvg === null ? "" : fmt1(s.intake.waitAvg)],
    ["Encuestas de satisfacción", s.satisfaction.count],
    ["Calidad de la atención (1-5)", fmt1(s.satisfaction.attention)],
    ["Claridad de las explicaciones (1-5)", fmt1(s.satisfaction.communication)],
    ["Trato del equipo (1-5)", fmt1(s.satisfaction.treatment)],
    ["Satisfacción general (1-5)", fmt1(s.satisfaction.overall)],
    ["Recomendaría el CIMT %", s.satisfaction.recommend ?? ""],
    [],
    ["Profesional", "Turnos", "Prácticas", "Ausentes", "Justificados"],
    ...a.byProfessional.map((r) => [r.name, r.scheduled, r.present, r.absent, r.justified]),
    ...section("Localidad", "Ingresos", s.admissions.byLocality),
    ...section("Edad", "Ingresos", s.admissions.byAge),
    ...section("Tipo de paciente", "Ingresos", s.admissions.byType),
    ...section("Obra social", "Ingresos", s.admissions.byInsurance),
    ...section("Condición asociada", "Ingresos", s.admissions.byCondition),
    ...section("Estado de la solicitud", "Solicitudes", s.intake.byStatus),
    ...section("Especialidad", "Derivaciones", s.referrals.bySpecialty),
    [],
    ["SITUACIÓN ACTUAL"],
    ["Pacientes registrados", s.current.total],
    ["Pacientes activos", s.current.active],
    ["Derivaciones pendientes", s.current.pendingReferrals],
    ["Derivaciones sin registrar", s.current.unregistered],
    ...section("Estado del caso", "Pacientes", s.current.byStatus),
    ...section("Tipo de terapia", "Pacientes", s.current.byTherapy),
  ];
  const cell = (v: unknown) => {
    const str = v === undefined || v === null ? "" : String(v);
    return /[;"\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = rows.map((r) => r.map(cell).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `estadisticas-cimt-${(s.range.start ?? "todo")}-${todayKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
