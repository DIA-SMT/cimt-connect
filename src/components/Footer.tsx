import { MapPin, Clock, Phone, Mail } from "lucide-react";
import { CENTER } from "@/lib/center";

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
                {CENTER.address}, {CENTER.city}
              </li>
              <li className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-primary" />
                {CENTER.hoursLong}
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-primary" />
                <a href={CENTER.phoneHref} className="hover:text-foreground hover:underline">
                  {CENTER.phoneDisplay}
                </a>
                <span className="text-xs">({CENTER.phoneNote.toLowerCase()})</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-primary" />
                <a href={`mailto:${CENTER.email}`} className="hover:text-foreground hover:underline">
                  {CENTER.email}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
              Atención
            </h4>
            <p className="mt-3 text-sm text-muted-foreground">
              Servicio público y gratuito, con turno programado.<br />
              Presencial y por telemedicina, desde los {CENTER.minAge} años.
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
