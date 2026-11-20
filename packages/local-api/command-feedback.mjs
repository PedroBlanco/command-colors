/**
 * Only fixed, public-facing error categories can appear beside a game control.
 * HTTP JSON bodies and arbitrary thrown messages are never interpolated.
 * In particular, unknown 403/404 errors do not confirm an opponent's secrets.
 */
const explanations=Object.freeze({
  ACCION_NO_DISPONIBLE:'Esta acción no está disponible en la fase actual.',
  CARTA_NO_PROPIA:'Esa carta no está disponible en tu mano.',
  CLAVE_INVALIDA:'No se ha podido preparar la solicitud. Inténtalo de nuevo.',
  ORDENES_INVALIDAS:'Revisa las unidades seleccionadas para recibir órdenes.',
  UNIDAD_NO_DISPONIBLE:'La unidad elegida no está disponible para esta orden.',
  UNIDAD_NO_PROPIA:'Solo puedes ordenar o mover tus propias unidades.',
  UNIDAD_YA_MOVIDA:'Esta unidad ya se ha movido en el turno.',
  RUTA_INVALIDA:'La ruta indicada no es válida. Revisa sus hexágonos.',
  OBJETIVO_INVALIDO:'Selecciona un objetivo válido para esta acción.',
  RESPUESTA_INVALIDA:'Selecciona una respuesta defensiva válida.',
  PARTIDA_DESACTUALIZADA:'La partida ha cambiado. Vuelve a consultarla.',
  INICIALIZACION_NO_DISPONIBLE:'El mazo no puede iniciarse en este momento.',
  STALE_REVISION:'La partida ha cambiado. Actualiza su estado antes de repetir la acción.',
  NOT_YOUR_TURN:'No te corresponde actuar en este turno.',
  NOT_AVAILABLE:'La acción no está disponible en este momento.',
  UNSUPPORTED_COMMAND:'El servidor no admite esta acción.',
  IDEMPOTENCY_KEY_REUSED:'La solicitud ya se utilizó para una acción diferente.',
  UNDO_NOT_AVAILABLE_AFTER_MOVEMENT:'No se pueden deshacer órdenes después de empezar a mover.',
  INVALID_PHASE:'No puedes realizar esa acción en la fase actual.',
  HEX_OCUPADO:'El hexágono de destino está ocupado.',
  HEX_REPETIDO:'Ese hexágono ya forma parte del recorrido.',
  HEX_INVALIDO:'El hexágono elegido no es válido.',
  RUTA_INACCESIBLE:'No hay un recorrido libre hasta el hexágono elegido.',
  RUTA_DEMASIADO_LARGA:'La ruta supera el límite de pasos del laboratorio.',
  BORRADOR_DESACTUALIZADO:'La partida ha cambiado. Vuelve a seleccionar la unidad.',
  SELECCIONA_UNIDAD_PROPIA:'Selecciona primero una unidad propia.',
  OBJETIVO_RIVAL_REQUERIDO:'Selecciona una unidad rival antes de solicitar defensa.',
  MOVIMIENTO_NO_DISPONIBLE:'No puedes mover una unidad en esta fase.'
});
const generic='No se pudo completar la acción. Comprueba el estado de la partida y vuelve a intentarlo.';
export function describeCommandError(error) {
  const raw=typeof error==='string'?error:error?.message;
  if(typeof raw!=='string'||raw.length>120)return generic;
  // Parsing a status/code does not imply this code or the response is trusted.
  const http=/^([45][0-9]{2}): ([A-Z][A-Z0-9_]{0,79})$/.exec(raw);
  if(http) {
    const status=Number(http[1]);
    if(status===401)return 'La sesión ha caducado. Identifícate de nuevo.';
    if(status===403)return 'No tienes permiso para realizar esta acción.';
    if(status===404)return 'La partida o la acción ya no están disponibles.';
    if(status===429)return 'Demasiadas solicitudes. Inténtalo más tarde.';
    if(status>=500)return 'El servidor no está disponible. Inténtalo más tarde.';
    return Object.hasOwn(explanations,http[2])?explanations[http[2]]:
      'El servidor ha rechazado la acción. Consulta el estado de la partida.';
  }
  return Object.hasOwn(explanations,raw)?explanations[raw]:generic;
}
