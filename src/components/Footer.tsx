import { MapPin, Clock, Phone, Mail } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border/60 bg-[color:var(--primary-soft)]/40">
      <div className="container mx-auto px-4 py-12 md:px-6">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <h3 className="text-lg font-bold text-[color:var(--primary-deep)]">CIMT</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Centro Integral Municipal de Tartamudez. Atención gratuita e interdisciplinaria
              para personas con disfluencia.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
              Contacto
            </h4>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Catamarca 411, San Miguel de Tucumán
              </li>
              <li className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-primary" />
                Lun a Vie · 07:30 a 17:30 hs
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-primary" />
                (0381) 4XX-XXXX
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-primary" />
                cimt@smt.gob.ar
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
              Atención
            </h4>
            <p className="mt-3 text-sm text-muted-foreground">
              Servicio público y gratuito.<br />
              Detección temprana, diagnóstico y tratamiento integral de la disfluencia.
            </p>
          </div>
        </div>
        <div className="mt-10 border-t border-border/60 pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Municipalidad de San Miguel de Tucumán — CIMT
        </div>
      </div>
    </footer>
  );
}