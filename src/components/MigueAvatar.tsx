import migueAvatar from "@/assets/migue-avatar.jpg";

// Avatar de Migue, el asistente virtual. La imagen es decorativa: en el
// encabezado el nombre aparece al lado, y en las filas de mensajes se pasa
// `label` para que los lectores de pantalla sepan quién habla.

const SIZES = {
  sm: "h-8 w-8 ring-1",
  md: "h-10 w-10 ring-2",
} as const;

export function MigueAvatar({ size = "md", label }: { size?: keyof typeof SIZES; label?: string }) {
  return (
    <>
      <img
        src={migueAvatar}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`${SIZES[size]} shrink-0 rounded-full bg-[#fafafa] object-cover ring-primary/25 shadow-sm`}
      />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}
