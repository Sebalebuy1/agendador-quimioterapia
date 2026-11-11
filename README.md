# Agendador de sillones de quimioterapia · prototipo funcional

Prototipo web de la tesis de Magíster (UAI) de Sebastián Lebuy, profesor guía Guido Lagos.

Agenda pacientes de quimioterapia con el modelo final de la tesis:

- agendamiento online basado en predicción de Pham et al. (2023), con un regresor XGBoost (estado F3) exportado a JavaScript;
- servidor tripartito de Karakaya, Gul y Çelik (2023): sillón × enfermería × carga de enfermería;
- protocolos de quimioterapia y plazos GES de Chile.

La agenda inicial se llena con pacientes simulados. Los pacientes nuevos se ingresan a mano. Cuando conviene, el sistema propone reacomodar sesiones futuras de otros pacientes a otro sillón del mismo día y turno.

Al hacer clic en una reserva del calendario se puede cambiar su hora (cupos posibles el mismo día), editar sus datos (duración, agudeza, nombre), reagendar lo que queda del protocolo con el mismo motor (mejor cupo, con reacomodo opcional y referencia greedy) o cancelarla.

Sitio: https://sebalebuy1.github.io/agendador-quimioterapia/ · Todos los datos son simulados y se guardan solo en el navegador.
