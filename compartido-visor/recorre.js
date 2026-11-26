/*
 * RECORRER UNA CONSULTA FILA A FILA SIN QUE SE CORTE.
 * En Node 22.13 (el del servidor en la nube), `db.prepare(sql).iterate()` deja la sentencia sin dueño: cuando el recolector de
 * memoria pasa a mitad del recorrido la finaliza y la lectura falla con «statement has been finalized». Pasa con tablas grandes
 * (un modelo real), no con las pequeñas. Aquí la sentencia queda retenida hasta que el recorrido termina.
 */
'use strict';
/** Como db.prepare(sql).iterate(...args), con la sentencia retenida. */
function* recorre(db, sql, ...args) { const st = db.prepare(sql); try { for (const r of st.iterate(...args)) yield r; } finally { void st.sourceSQL; } }
/** Como st.iterate(...args) para una sentencia ya preparada. */
function* recorreSt(st, ...args) { try { for (const r of st.iterate(...args)) yield r; } finally { void st.sourceSQL; } }
module.exports = { recorre, recorreSt };
