// Regla única de contraseñas (panel y portal de familias): cada persona elige
// la que quiera. El único mínimo es el de Supabase Auth, que no acepta menos
// de 6 caracteres y no se puede bajar. El máximo de 72 es el límite de bcrypt.
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;
export const PASSWORD_MIN_MESSAGE = `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres`;
