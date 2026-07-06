const { EXCEL_SCHEMA_VERSION } = require("../models/convenio.model");

function universalConventionTemplateForPrompt() {
  return {
    schemaVersion: EXCEL_SCHEMA_VERSION,
    convenio: {
      convenio_id: "",
      tipo_norma: "",
      numero: "",
      "a\u00f1o": "",
      denominacion: "",
      actividad: "",
      rama: "",
      jurisdiccion: "",
      organismo: "",
      partes_sindicales: "",
      partes_empleadoras: "",
      fecha_homologacion: "",
      vigencia_desde: "",
      vigencia_hasta: "",
      ambito_territorial: "",
      personal_comprendido: "",
      personal_excluido: "",
      fuente_documento: ""
    },
    ambitos: [],
    categorias: [],
    conceptos: [],
    escalas: [],
    adicionales: []
  };
}

function conventionExtractionContractForPrompt() {
  return {
    "convention": {
      "identification": {
        "id": "string (slug estable extraído del documento)",
        "name": "string (nombre legal o actividad extraída)",
        "shortName": "string",
        "source": "string (CCT, acta o resolución detectada)",
        "type": "monthly | daily | hourly | empty"
      },
      "periods": [
        {
          "id": "string (format YYYY-MM)",
          "label": "string",
          "effectiveFrom": "string (YYYY-MM-DD o empty)",
          "effectiveTo": "string (YYYY-MM-DD o empty)",
          "sourceFileName": "string"
        }
      ],
      "zones": [
        {
          "id": "string",
          "label": "string",
          "coef": "number | null",
          "description": "string"
        }
      ],
      "categories": [
        {
          "id": "string",
          "label": "string (categoría laboral)",
          "group": "string (agrupador o jornada)",
          "description": "string",
          "zone": "string (id de zona o empty)",
          "monthly": "number | null",
          "day": "number | null",
          "hourly": "number | null",
          "monthlyByPeriod": {
            "YYYY-MM": "number"
          },
          "dayByPeriod": {
            "YYYY-MM": "number"
          },
          "hourlyByPeriod": {
            "YYYY-MM": "number"
          },
          "nonRem": {
            "YYYY-MM": "number"
          },
          "normalWeeklyHours": "number | null",
          "normalDailyHours": "number | null",
          "legalReferences": [
            "string"
          ],
          "notes": [
            "string"
          ]
        }
      ],
      "rules": {
        "salaryType": "monthly | daily | hourly | empty",
        "monthDivisor": "number | null",
        "dayDivisor": "number | null",
        "hourDivisor": "number | null",
        "weeklyHours": "number | null",
        "vacationDivisor": "number | null",
        "licenses": [
          {
            "name": "string",
            "rule": "string (regla extraída)",
            "evidence": "string"
          }
        ],
        "legalReferences": [
          "string"
        ]
      },
      "liquidationModel": {
        "rules": {
          "seniority": {
            "enabled": "boolean | null",
            "mode": "string",
            "percentPerYear": "number | null",
            "capYears": "number | null",
            "base": "string",
            "legalReferences": [
              "string"
            ]
          },
          "presentism": {
            "enabled": "boolean | null",
            "percent": "number | null",
            "base": "string",
            "requiresNoUnjustifiedAbsence": "boolean | null",
            "legalReferences": [
              "string"
            ]
          },
          "nonRemunerativeScale": {
            "enabled": "boolean | null",
            "seniorityEnabled": "boolean | null",
            "seniorityPercentPerYear": "number | null",
            "seniorityCapYears": "number | null",
            "presentismEnabled": "boolean | null",
            "presentismPercent": "number | null",
            "presentismRequiresNoUnjustifiedAbsence": "boolean | null",
            "subjectToHealthInsurance": "boolean | null",
            "subjectToUnion": "boolean | null",
            "legalReferences": [
              "string"
            ]
          },
          "overtime": {
            "enabled": "boolean | null",
            "divisor": "number | null",
            "rate50": "number | null",
            "rate100": "number | null",
            "legalReferences": [
              "string"
            ]
          }
        },
        "concepts": [
          {
            "id": "string",
            "label": "string",
            "group": "string",
            "inputType": "checkbox | number",
            "rowType": "remunerative | nonRemunerative",
            "calculation": "fixed | percentOfBase | amountPerUnit",
            "percent": "number | null",
            "amount": "number | null",
            "amountByPeriod": {
              "YYYY-MM": "number"
            },
            "unitAmount": "number | null",
            "unitAmountByPeriod": {
              "YYYY-MM": "number"
            },
            "base": "string",
            "defaultValue": "boolean | number",
            "requiresHumanValidation": "boolean",
            "legalReferences": [
              "string"
            ],
            "sourceFiles": [
              "string"
            ],
            "detail": "string (evidencia)",
            "notes": [
              "string"
            ]
          }
        ],
        "deductions": [
          {
            "id": "string",
            "label": "string (descuento del trabajador)",
            "calculation": "fixed | percentOfBase",
            "percent": "number | null",
            "amount": "number | null",
            "amountByPeriod": {
              "YYYY-MM": "number"
            },
            "base": "string",
            "defaultValue": "boolean",
            "appliesWhen": "string",
            "requiresHumanValidation": "boolean",
            "legalReferences": [
              "string"
            ],
            "sourceFiles": [
              "string"
            ],
            "detail": "string (evidencia)"
          }
        ],
        "retentions": [
          {
            "id": "string",
            "label": "string (retención)",
            "calculation": "fixed | percentOfBase",
            "percent": "number | null",
            "amount": "number | null",
            "amountByPeriod": {
              "YYYY-MM": "number"
            },
            "base": "string",
            "defaultValue": "boolean",
            "appliesWhen": "string",
            "requiresHumanValidation": "boolean",
            "legalReferences": [
              "string"
            ],
            "sourceFiles": [
              "string"
            ],
            "detail": "string (evidencia)"
          }
        ]
      }
    }
  };      
} 

function buildConventionPrompt({ draftName, notes }) {
  return [
    "INSTRUCCION PARA EL AGENTE ESTRUCTURADOR DE CONVENIOS COLECTIVOS",
    "Actúa como un experto liquidador de sueldos en Argentina. Tu tarea es extraer todos los datos necesarios para una liquidación de sueldos.",
    "Debes extraer los haberes remunerativos, no remunerativos, retenciones y licencias (y las escalas salariales si corresponde).",
    "DEBE ESTAR SÍ O SÍ el cálculo para cada concepto; si es extraído de una tabla, indícalo explícitamente.",
    "ATENCIÓN: No copies doctrina ni texto juridico extenso. Extrae solamente reglas computables necesarias para liquidar, tanto del CCT como de la Ley de Trabajo Aplicable cuando corresponda, siempre con su fuente diferenciada.",
    "Debes analizar la totalidad de la documentacion enviada en esta solicitud: texto principal, actas complementarias, acuerdos salariales, escalas salariales, anexos, tablas, imagenes, cuadros, notas al pie, adendas y resoluciones homologatorias.",
    "Si el texto extraido es insuficiente, fragmentado o vacio, inspecciona visualmente el PDF o imagen original pagina por pagina. No asumas que una pagina sin texto esta vacia. Marca confianza baja y requiere_revision_manual en todo dato visual dudoso.",
    "Primero clasifica cada adjunto o bloque de texto como uno de estos tipos: CCT_BASE, ACTA_ACUERDO, HOMOLOGACION, ESCALA_SALARIAL, ANEXO_ESCALA, ANEXO_REGLAS, RESOLUCION, OTRO. No lo agregues como campo raiz; conserva la clasificacion en documento_tipo/documento_rol/fuente_documento de los objetos extraidos.",
    "Cada dato importante debe tener trazabilidad compacta cuando sea posible: fuente_documento, documento_tipo, pagina, evidencia y confianza. evidencia debe ser una frase o fragmento corto, no un parrafo largo.",
    "Si un concepto laboral no aparece en el CCT pero si en la Ley de Trabajo Aplicable, extrailo desde esa ley, mantenelo en el estructurador y marca su origen con fuente_documento='LEY_DE_TRABAJO_APLICABLE' y documento_tipo='LEY_TRABAJO_BASE'. No lo inventes ni lo dejes vacio.",
    "OBLIGATORIO: antes de cerrar el JSON, compara los conceptos del CCT contra la Ley de Trabajo Aplicable y agrega cualquier concepto laboral general que falte en el CCT pero exista en la ley. No agregues reglas especificas del CCT desde la ley; solo faltantes generales necesarios para estructurar y liquidar. Si la ley cargada no esta disponible, detente y marca requiere_revision_manual.",
    "AISLAMIENTO ABSOLUTO: cada estructuracion empieza desde cero. Ignora por completo convenios anteriores, ejemplos de otros CCT, catalogos internos, memoria de conversaciones, borradores previos, datos aprobados, nombres de archivos anteriores y cualquier convenio precargado. Conserva todos los periodos salariales documentados y su vigencia; marca cual es vigente, futuro o historico. Nunca descartes un periodo solamente por no pertenecer al año actual.",
    "Nunca completes datos usando otro CCT aunque parezca parecido. Si el documento actual no contiene el dato, usa cadena vacia, null o lista vacia segun corresponda y agrega una advertencia trazable; no escribas el faltante como si fuera un valor real.",
    "Si el documento remite a una escala, planilla o anexo que no fue adjuntado, no inventes su contenido: deja escalas vacio y conserva la referencia documental; el clasificador informara requiere_escala_anexa y revision humana.",
    "Todo dato que afecte el calculo del sueldo debe ser identificado y clasificado. No omitir conceptos. No resumir articulos. No inventar informacion.",
    "Si una regla no puede determinarse con certeza, escribir: requiere revision manual.",
    "EXTRAER OBLIGATORIAMENTE informacion general: numero de convenio, anio, denominacion, actividad, rama, jurisdiccion, ambito territorial, ambito personal, partes firmantes, fecha de homologacion, vigencia y organismo homologante.",
    "EXTRAER OBLIGATORIAMENTE todas las categorias laborales: nombre, codigo si existe, descripcion, tareas, nivel jerarquico, rama, grupo_nombre, agrupamiento, sector o seccion y modalidad.",
    "Distinguir categoria laboral de concepto/adicional: Adicional, Plus, Premio, Bono, Viatico, Asignacion, Presentismo, Antiguedad, Titulo, Falla/Quebranto de caja, Movilidad, Refrigerio, No Remunerativo, Aporte, Cuota, Fondo, Seguro y Contribucion no son categorias laborales salvo que el documento diga explicitamente que son puestos/categorias.",
    "Si una categoría se repite en diferentes ramas (ej: título de la tabla) o zonas (ej: columnas separadas), NO crees múltiples categorías (no hagas 'Supervisor Rama A', 'Supervisor Rama B'). Crea una ÚNICA categoría general en el listado raíz (ej: 'Supervisor'). Luego, en la escala salarial, utiliza el mismo categoria_id para todos los importes, pero diferencia cada importe asignándole el campo rama o zona correspondiente en escalas[].valores[].",
    categoryHierarchyRulesForPrompt(),
    "NO extraigas tablas salariales completas en esta llamada. Las escalas salariales se extraen en una segunda llamada separada. En esta llamada deja escalas: [] salvo que el texto principal contenga una regla salarial sin tabla separada.",
    "EXTRAER OBLIGATORIAMENTE haberes remunerativos: sueldo basico, antiguedad, presentismo, puntualidad, titulo, funcion, caja, zona, altura, riesgo, horas extras, nocturnidad, feriados, francos trabajados, guardias, disponibilidad, productividad, comisiones y premios.",
    "SUELDO_BASICO es solo salario basico de escala. Sueldo Anual Complementario, SAC o Aguinaldo debe ir como concepto SAC, nunca como SUELDO_BASICO.",
    "Para cada concepto extraer datos compactos: nombre, articulo, formula corta, base de calculo, porcentaje, importe fijo, condicion breve, tope y frecuencia. No copies parrafos completos.",
    "ATENCION: Toma TODOS los valores salariales y periodos presentes en la documentacion. No omitas meses, tramos futuros ni vigencias anteriores publicadas; identifica cada periodo por separado.",
    "EXTRAER OBLIGATORIAMENTE haberes no remunerativos: sumas no remunerativas, no remunerativos de escala, asignaciones, bonos, gratificaciones extraordinarias, viaticos, beneficios en especie y ticket alimentacion. Extraer formula corta, condiciones breves, base, tope y vigencia.",
    "Todo haber no remunerativo debe ir en conceptos con tipo_concepto haber y estrictamente naturaleza no_remunerativo, unidad_calculo, formula_base, base_calculo, condicion y es_liquidable true salvo que el documento lo declare solo informativo.",
    "Clasificacion obligatoria de conceptos: tipo_concepto debe ser haber, descuento, retencion, aporte_patronal o referencia. No uses remunerativo/no_remunerativo como tipo_concepto; eso va en naturaleza.",
    "Naturaleza obligatoria: remunerativo, no_remunerativo, retencion, contribucion_patronal, referencial o requiere_revision_manual si el documento no permite determinarlo. No dejar naturaleza vacia.",
    "Dividir conceptos en tres grupos liquidatorios principales: haberes remunerativos = tipo_concepto haber + naturaleza remunerativo; haberes no remunerativos = tipo_concepto haber + naturaleza no_remunerativo; deducciones = tipo_concepto descuento o retencion + naturaleza retencion. No clasifiques deducciones, aportes del trabajador, cuota sindical, obra social ni fondos como haberes remunerativos.",
    "ATENCION CRITICA: Revisa minuciosamente los haberes que sean 'no remunerativos'. Asegurate de separarlos correctamente asignandoles SIEMPRE naturaleza 'no_remunerativo'. BAJO NINGUN CONCEPTO los agrupes o clasifiques como 'remunerativo'.",
    "Base de calculo obligatoria y computable: sueldo_basico, total_remunerativo, haberes_remunerativos, remuneracion_sujeta_a_aporte, escala_salarial, valor_hora, valor_dia, monto_fijo o requiere_revision_manual. Si el documento da otra base, conservarla como texto breve en base_calculo.",
    "Formula de calculo obligatoria en formula_base: valor_escala_categoria, monto_fijo, porcentaje_sobre_base, porcentaje_sobre_valor_hora, cantidad_por_valor_unitario, valor_referencia_escala o requiere_revision_manual. Si el documento muestra una formula concreta, resumirla sin inventar.",
    "EXTRAER OBLIGATORIAMENTE descuentos y retenciones legales y convencionales: jubilacion, Ley 19032, obra social, seguro, cuota sindical, fondo solidario, aportes especiales y contribuciones extraordinarias. Extraer base imponible, porcentaje, tope y condiciones.",
    "EXTRAER OBLIGATORIAMENTE aportes y contribuciones patronales: fondo solidario empleador, contribuciones sindicales, aportes a camaras empresarias, seguros obligatorios y cualquier obligacion patronal creada por el convenio.",
    "NO pongas licencias, vacaciones, maternidad, nacimiento, matrimonio, fallecimiento, examenes, enfermedad o accidentes dentro de conceptos liquidables salvo que exista un adicional salarial periodico con formula/importe. Esos derechos no son haberes mensuales.",
    "EXTRAER OBLIGATORIAMENTE jornada laboral: horario normal, jornada maxima, jornada reducida, jornada nocturna, jornada insalubre, descansos y francos.",
    "EXTRAER OBLIGATORIAMENTE horas extras: horas al 50%, horas al 100%, feriados, nocturnas, bases de calculo y formulas.",
    "EXTRAER OBLIGATORIAMENTE antiguedad completa: escalas, tramos, formula, topes y base de calculo.",
    "EXTRAER OBLIGATORIAMENTE presentismo y puntualidad: como se calcula, cuando se pierde, cuando se reduce y base utilizada.",
    "EXTRAER OBLIGATORIAMENTE reglas de liquidacion: divisor mensual, divisor diario, divisor horario, redondeos, minimos garantizados, garantias salariales, compensaciones, absorciones y topes.",
    "Cuando el documento contiene tablas, pensar en matriz: categoria x periodo x concepto x zona x modalidad x unidad_pago. Cada celda monetaria debe convertirse en escalas[].valores[] si es valor salarial, no en texto libre.",
    "Soportar tablas con categorias en filas y periodos en columnas, periodos en filas y categorias en paginas separadas, grupos/ramas/agrupamientos/sectores/secciones como encabezados intermedios, zonas/regiones como subtitulos, y columnas de basico/no remunerativo/total.",
    "categorias debe contener solo puestos/cargos/clases/grupos laborales reales. Si la tabla salarial separa el mismo puesto por modalidad con montos distintos (por ejemplo con retiro / sin retiro), crear una categoria por cada variante y reflejar la modalidad en categoria_nombre y modalidad_aplicable. Sin embargo, si la tabla usa encabezados de rama, zona, grupo o sector (ej: Rama 1, Rama 2, Zona A, Zona B), NO dupliques la categoría por cada rama/zona. Creá una única categoría y guardá la rama y zona únicamente en escalas[].valores[].",
    "No uses salaryType monthly por defecto. Si el CCT o la escala habla de jornal, dia, changa, valor dia o pago por dia, usa daily y completa day/dayByPeriod. Si habla de hora o valor hora, usa hourly y completa hourly/hourlyByPeriod. Usa monthly solo cuando el basico sea mensual.",
    "Toda formula encontrada debe quedar estructurada en sintaxis matematica clara para que la calculadora pueda leerla, por ejemplo: (sueldo_basico * 0.02) o (valor_hora * 1.5 * horas). No uses 'por ciento' ni 'x', usa '*', '/', '+' y '-'.",
    "Antes de finalizar verificar categorias, escalas salariales, haberes remunerativos, haberes no remunerativos, retenciones, aportes patronales, licencias, jornada laboral, horas extras, formulas de calculo y reglas de liquidacion. Si falta alguno, indicar: Informacion no encontrada en la documentacion analizada.",
    "REGLA CRITICA: devolve un JSON plano con EXACTAMENTE estas claves raiz: schemaVersion, convenio, ambitos, categorias, conceptos, escalas, adicionales. No agregues ningun otro campo raiz.",
    "Campos raiz prohibidos: architectureVersion, processingPipeline, structuredModel, structureValidation, metadata, auditoria, flujo_liquidacion, reglas_validacion, novedades_requeridas.",
    "No crear escalas vacias. Solo crear una escala si hay nombre_escala, periodo_desde, periodo_hasta o al menos un valor salarial dentro de valores.",
    "No crear categorias sin categoria_nombre si el nombre esta disponible en el texto. Si no se identifica el nombre real, no inventar.",
    "Estructura el convenio desde cero usando exclusivamente la documentacion enviada en esta solicitud. No uses catalogos, convenios precargados, memoria, borradores previos ni rastros de convenios eliminados.",
    "La IA solo estructura datos. No calcules sueldos ni inventes importes, porcentajes, articulos o reglas. Si falta texto usa \"\"; si falta numero usa null; si falta lista usa [].",
    "Devuelve exclusivamente JSON valido, sin explicaciones ni bloques de formato.",
    "La respuesta debe ser compacta y completa. Prioriza JSON valido. No dejes cadenas sin cerrar. No agregues texto fuera del JSON.",
    "Usa schemaVersion esueldos-cct-estructura-excel-v1 y la estructura Excel: convenio, ambitos, categorias, conceptos, escalas con valores y adicionales.",
    "Diferencia haberes remunerativos, haberes no remunerativos, descuentos, retenciones y aportes patronales en conceptos.tipo_concepto y conceptos.naturaleza.",
    "Para haberes: tipo_concepto siempre debe ser haber; naturaleza indica si es remunerativo o no_remunerativo.",
    "ES IMPRESCINDIBLE diferenciar los haberes NO REMUNERATIVOS. Verifica que su naturaleza sea exactamente 'no_remunerativo'.",
    "Las tablas separadas de adicionales deben ir en adicionales o conceptos, no como categorias.",
    "No inventes zona desfavorable, plus zona ni porcentajes regionales. Solo extraelos si aparecen explicitamente en la documentacion analizada.",
    "La zona General/Base/Sin adicional debe conservarse en zona como General o general cuando aparezca.",
    "Devolve JSON valido con esta forma exacta: {\"schemaVersion\":\"esueldos-cct-estructura-excel-v1\",\"convenio\":{},\"ambitos\":[],\"categorias\":[],\"conceptos\":[],\"escalas\":[],\"adicionales\":[]}.",
    "Campos internos importantes: categorias[].categoria_id/categoria_nombre; conceptos[].concepto_id/nombre/tipo_concepto/naturaleza/unidad_calculo/formula_base/base_calculo/condicion/es_liquidable; escalas[].valores[].categoria_id/concepto_id/modalidad/unidad_pago/periodicidad/valor/moneda/zona. Trazabilidad opcional por objeto: documento_tipo, documento_rol, evidencia, pagina, confianza.",
    draftName ? `Etiqueta informativa escrita por el usuario: ${draftName}. No la uses como evidencia legal ni como reemplazo de la identificacion extraida de los adjuntos.` : "Etiqueta informativa escrita por el usuario: sin etiqueta.",
    notes ? `Notas informativas del usuario: ${notes}. No las uses como reemplazo de evidencia documental.` : "Notas informativas del usuario: sin notas."
  ].join("\n");
}

function categoryHierarchyRulesForPrompt() {
  return [
    "REGLAS CRITICAS DE JERARQUIA DE CATEGORIAS:",
    "- La categoría representa UNICAMENTE el cargo o puesto (ej: 'Administrativo A', 'Oficial', 'Chofer').",
    "- La rama NUNCA forma parte del nombre de la categoría. Usá categorias[].rama y escalas[].valores[].rama.",
    "- La zona NUNCA forma parte del nombre. Usá categorias[].zona y escalas[].valores[].zona.",
    "- Los encabezados de tablas (PERSONAL, ADMINISTRATIVOS, Rama Producción, Zona Norte) son contexto, NO categorías.",
    "- Si cambia únicamente la zona entre filas o columnas, NO crees una categoría nueva: reutilizá el mismo categoria_id.",
    "- Si cambia únicamente la rama, tampoco crees categoría nueva: reutilizá el mismo categoria_id y diferenciá en escalas[].valores[].",
    "- Heredá rama, zona, agrupamiento o clase desde encabezados intermedios hasta el próximo encabezado.",
    "- Reutilizá la misma categoría cuando solo cambian salarios según zona o rama.",
    "",
    "EJEMPLO 1 - Zonas en columnas:",
    "Tabla: | Categoría | Zona Norte | Zona Sur | -> categorias: [{ categoria_id:'adm-a', categoria_nombre:'Administrativo A' }]; escalas[].valores: [{ categoria_id:'adm-a', zona:'Norte', valor:1000 }, { categoria_id:'adm-a', zona:'Sur', valor:950 }].",
    "",
    "EJEMPLO 2 - Ramas en bloques:",
    "Tabla: Rama Administrativa -> Auxiliar $500; Rama Técnica -> Auxiliar $520 -> categorias: [{ categoria_id:'aux', categoria_nombre:'Auxiliar' }]; valores: [{ categoria_id:'aux', rama:'Administrativa', valor:500 }, { categoria_id:'aux', rama:'Técnica', valor:520 }].",
    "",
    "EJEMPLO 3 - Encabezado + letras:",
    "Administrativos / A / B / C -> categorias: [{ categoria_nombre:'A', grupo_nombre:'Administrativos' }, { categoria_nombre:'B', grupo_nombre:'Administrativos' }, { categoria_nombre:'C', grupo_nombre:'Administrativos' }]. NO crear categoría 'Administrativos'.",
    "",
    "EJEMPLO 4 - Encabezados prohibidos:",
    "Filas ESCALA SALARIAL, REMUNERACIONES o BÁSICOS NO son categorías. Ignorarlas como filas y usarlas solo como contexto de tabla."
  ].join("\n");
}

function buildConventionCorePrompt({ draftName, notes }) {
  return [
    "Actúa como un experto liquidador de sueldos en Argentina. Extrae todos los datos necesarios para una liquidación de sueldos (haberes remunerativos, no remunerativos, retenciones y licencias).",
    "Debe estar sí o sí el cálculo para cada concepto. Si es de una tabla, indícalo. NO metas leyes ni texto jurídico, solo lo estrictamente necesario para liquidar sueldos.",
    "Tu objetivo en esta llamada es extraer SOLO los datos nucleares y el esqueleto legal del CCT. NO extraigas escalas salariales completas: deja escalas: []. La escala se procesa en otra llamada.",
    "[AISLAMIENTO ABSOLUTO] Cada ejecución comienza desde cero. Ignora convenios anteriores o conocimientos preexistentes. Si un dato no está en el documento, escribe null o [].",
    "Devuelve EXCLUSIVAMENTE un objeto JSON válido, compacto, sin texto explicativo ni bloques de formato. Claves raíz exactas: schemaVersion, convenio, ambitos, categorias, conceptos, escalas, adicionales, rules.",
    "schemaVersion debe ser 'esueldos-cct-estructura-excel-v1'.",
    
    // 1. CONVENIO Y TRAZABILIDAD
    "CONVENIO: Extrae numero, anio, denominacion, actividad, rama, jurisdiccion, ambito_territorial, partes_firmantes, fecha_homologacion y vigencia.",
    "Clasifica el origen del bloque/documento dentro de 'documento_tipo' como: CCT_BASE, ACTA_ACUERDO, HOMOLOGACION, RESOLUCION u OTRO.",
    
    // 2. CATEGORÍAS (Estructura de Puestos)
    "CATEGORÍAS: Identifica los puestos reales. Extrae el nombre puro del puesto (ej: 'Ayudante') y NO le pegues el nombre de la rama, sector o zona (no pongas 'Ayudante Canalización'). Si una misma categoría se repite en diferentes ramas, sectores o zonas, NO crees múltiples categorías. Crea una única categoría ('Ayudante'). La rama, sector o zona específica se indicará luego en la matriz de la escala salarial.",
    categoryHierarchyRulesForPrompt(),
    "Variantes de jornada o modalidad (ej: Con Retiro/Sin Retiro, Completa/Media) deben duplicarse como categorias separadas SOLO si refieren a la forma de trabajo. Los nombres de ramas, sectores, agrupamientos o zonas (ej: Canalización, Líneas, Redes, Zona Sur) NO son modalidades. NUNCA dupliques una categoría por su rama o sector, diferenciala únicamente en los valores de la escala salarial.",
    
    // 3. CONCEPTOS LIQUIDABLES (Reglas y Motores de Cálculo)
    "CONCEPTOS: Identifica todos los conceptos remunerativos, no remunerativos y retenciones mencionados en el texto legal.",
    "Prohibido crear conceptos dinámicos por mes o año (ej: NO crees BASICO_OCT_25). Usa ID genéricos: SUELDO_BASICO, VALOR_HORA, VALOR_DIARIO, NO_REMUNERATIVO, ADICIONAL_CONVENIO.",
    "El Sueldo Anual Complementario debe mapearse como concepto_id: 'SAC', nunca como SUELDO_BASICO.",
    "Diferencia estrictamente la NATURALEZA de los conceptos: Remunerativos (haber / remunerativo), No Remunerativos (haber / no_remunerativo), Deducciones (retencion o descuento / retencion). Es CRÍTICO que los adicionales calificados como 'no rem' tengan estrictamente esa naturaleza.",
    "Cada concepto debe parametrizarse con: unidad_calculo (monthly, hourly, daily, percentage, fixed), formula_base, base_calculo (sueldo_basico, total_remunerativo, etc.), condicion y detail (la evidencia).",
    "Viaticos, traslados, comida, pernocte, kilometraje u otros conceptos por dia, viaje, km u hora deben quedar como cantidad_por_valor_unitario o amountPerUnit, con unidad_calculo clara y valor unitario si existe. No los modeles como checkbox mensual salvo que el documento diga suma fija mensual.",
    
    // 4. LICENCIAS Y REGLAS
    "LICENCIAS: Dentro de la clave raíz 'rules', extrae un arreglo 'licenses' donde cada objeto tenga { name: 'string', rule: 'regla extraída', evidence: 'texto de evidencia' }. Incluye aquí licencias, vacaciones, maternidad, etc.",
    
    // 5 y 6. ADICIONALES FIJOS Y REGLAS DE LIQUIDACIÓN
    "Antigüedad: Determina la base de cálculo y la regla y estructurala en 'formula_base' con sintaxis matematica clara (ej: sueldo_basico * 0.01 * anios).",
    "Presentismo: Identifica si es un porcentaje (ej: 8.33% o doceava parte) o suma fija, y las causales de pérdida. Escribir formulas matematicas claras (ej: sueldo_basico * 0.0833).",
    "Si el CCT define divisores explícitos (ej: divisor vacacional 25, divisor hora 200), regístralo en las condiciones del concepto. Si no figura, coloca 'requiere_revision_manual'.",
    "Asegurate de que TODAS las formulas esten en formato matematico (ej: sueldo_basico * 0.020) para que la calculadora pueda interpretarlas directamente.",
    
    draftName ? `Etiqueta usuario: ${draftName}.` : "Etiqueta usuario: sin etiqueta.",
    notes ? `Notas usuario: ${notes}.` : "Notas usuario: sin notas."
  ].join("\n");
}

function buildScalePrompt({ draftName, notes, baseCategories = [], baseConcepts = [] }) {
  const baseCategoriesText = baseCategories.length 
    ? `\nCATEGORÍAS PRE-EXTRAÍDAS DEL CCT:\n${JSON.stringify(baseCategories.map(c => ({categoria_id: c.categoria_id, categoria_nombre: c.categoria_nombre})))}\nREGLA PARA EVITAR DUPLICADOS: Si la fila de la tabla salarial corresponde a una categoría de esta lista, usa EXACTAMENTE su 'categoria_id'. Si la fila contiene una categoría NUEVA que no está en la lista, extráela normalmente y créale un ID nuevo. Si la misma categoría ya apareció en el CCT, igual debe volver a aparecer en la escala con el mismo categoria_id para capturar sus valores.` 
    : "";
  const baseConceptsText = baseConcepts.length
    ? `\nCONCEPTOS PRE-EXTRAÍDOS DEL CCT:\n${JSON.stringify(baseConcepts.map(c => ({concepto_id: c.concepto_id, nombre: c.nombre})))}\nREGLA PARA HABERES EN TABLAS: Si el archivo de escala cuenta con haberes o adicionales (en cuadros separados o junto a la escala), relaciónalos con los 'concepto_id' de esta lista. Si hay un valor nuevo, extráelo en escalas[].valores[] usando el concepto_id. NO extraigas estos haberes o adicionales como categorías laborales, y NO los dupliques en el array raíz de conceptos. Si la escala repite una formula o adicional ya visto en el CCT, conservá la formula_base del CCT y usá la escala solo para el valor.` 
    : "";
  return [
    "Actuá como extractor de escalas salariales argentinas.",
    "Tu objetivo principal es extraer únicamente la estructura salarial del documento: categorías mínimas si son necesarias y tablas de valores salariales.",
    categoryHierarchyRulesForPrompt(),
    "Si el documento usa rama, grupo, agrupamiento, sector o seccion, copiá ese texto en grupo_nombre y rama. Si dos categorías tienen el mismo nombre, mantenelas como una única categoría general, y diferenciá los valores mediante los campos rama o zona en la escala salarial. Solo separá las categorías si tienen modalidades distintas reales (ej: Jornada Completa vs Media Jornada)." + baseCategoriesText + baseConceptsText,
    "Si el archivo es escaneado, una imagen o una tabla sin texto extraible, interpreta visualmente todas las paginas y celdas. Si una celda no es legible, no inventes el dato: dejalo null, conserva pagina/evidencia y marca confianza baja.",
    "[AISLAMIENTO ABSOLUTO] No uses memoria ni otros CCT. Solo el texto y las tablas de esta escala. Si falta un dato usa null o []. No inventes valores.",
    "Devuelve EXCLUSIVAMENTE un objeto JSON válido, compacto, sin texto explicativo ni bloques de formato. Claves raíz exactas: schemaVersion, convenio, categorias, escalas.",
    
    // 4. MATRIZ DE ESCALAS SALARIALES (El núcleo de esta función)
    "Piensa en una matriz multidimensional: Categoría x Periodo (Vigencia) x Concepto x Zona x Modalidad.",
    "Cada celda con valor monetario de la tabla salarial debe generar un elemento puro en el array 'escalas[].valores[]'.",
    "Si la tabla salarial está organizada por zonas en columnas o subcolumnas (por ejemplo Zona A, Zona B, Zona C, Zona D o Zona E), cada zona debe salir como un valor separado con su propio campo 'zona'. No copies la primera zona a las demás. Las zonas suelen aparecer como títulos de columna, no como categorías nuevas.",
    "Si la tabla muestra varias zonas para la misma categoría y la misma rama, tratá cada zona como una celda distinta de la matriz. No colapses Zona B/C/D/E en Zona A, aunque el resto de la fila sea igual. Si una zona no es legible, dejala vacía en vez de inventarla.",
    "Extrae de forma exhaustiva TODOS los periodos de vigencia concatenados o segmentados que aparezcan, aunque sean historicos o futuros. Cada mes o tramo debe conservarse como registro separado.",
    "Si el archivo trae más de un mes o varios bloques de vigencia, creá un registro separado por cada mes o tramo. No mezcles Abril, Mayo y Junio en un mismo objeto ni en un mismo nombre_escala si el PDF los presenta separados.",
    "Si el encabezado indica mes/año, guardalo tal cual en 'nombre_escala' o 'periodicidad' para que se pueda distinguir cada vigencia. No sustituyas un mes por el primero que aparezca.",
    "Si el PDF trae un anexo por mes y dentro de cada anexo repite bloques por rama, sector, sección o grupo, tratá cada bloque como una escala independiente de la misma vigencia. Conservá el nombre del bloque como rama o grupo_nombre.",
    "Si una misma vigencia repite varias secciones con títulos de rama, sector o grupo, no las unifiques: generá escalas separadas para cada bloque y mantené el mes común.",
    "Si dentro del mismo anexo aparece una 'suma no remunerativa mensual' o un bloque equivalente separado del salario básico, extraelo como otra escala o bloque de valores independiente, también separado por mes y por rama. No lo mezcles con el salario básico.",
    "Identifica correctamente el divisor y la unidad de pago: si la escala expresa valores por hora, setea 'unidad_pago' en 'hourly'; si es jornal, 'daily'; si es sueldo mensual, 'monthly'. No uses 'monthly' por defecto.",
    "Mapear columnas por posición cuando los encabezados estén separados de las filas (ej: si el encabezado dice 'Básico Abril 2026', el importe de esa columna es SUELDO_BASICO para ese periodo).",
    "Si la tabla aparece fragmentada por la lectura del PDF, reconstruye cada fila completa uniendo la línea de categoría con las líneas siguientes de importes hasta la próxima categoría.",
    
    // Mapeo de Conceptos desde las Columnas de la Tabla
    "No crees conceptos por mes ni por categoría. Usa ID canónicos reutilizables en escalas[].valores[].concepto_id: SUELDO_BASICO, NO_REMUNERATIVO, TOTAL_REMUNERATIVO, VALOR_HORA, VALOR_DIARIO, VIATICO.",
    "Columnas llamadas No Rem, Suma No Remunerativa o Incremento Solidario son haberes no remunerativos: asignales concepto_id 'NO_REMUNERATIVO' y en la sección conceptos dales naturaleza 'no_remunerativo' de forma estricta.",
    "Los totales publicados (ej: Total Remunerativo, Neto) deben guardarse con tipo_concepto 'referencia', naturaleza 'referencial' y es_liquidable false.",
    "Si un adicional (ej: Presentismo, Plus Asistencia) aparece con un importe fijo dentro de la tabla salarial, crealo en conceptos/adicionales y mandá sus montos a escalas[].valores[] con el categoria_id vacío si es general.",
    "Si una columna de viatico, traslado, comida, pernocte, kilometraje o valor por dia/viaje/km/hora representa valor unitario, modelala para pedir cantidad en liquidacion: calculation amountPerUnit o formula_base cantidad_por_valor_unitario.",
    
    // Control de Errores Numéricos
    "CRÍTICO: En Argentina, el punto (.) separa miles y la coma (,) separa decimales en documentos legales. Procesa los números bajo este criterio estricto (ej: 860.281 es ochocientos sesenta mil doscientos ochenta y uno).",
    "Asegúrate de que toda categoría que tenga una fila salarial en la tabla tenga su correspondiente 'categoria_id' idéntico en el listado de categorías raíz. Si la tabla nombra al puesto con la rama pegada (ej: 'Ayudante Canalización'), LIMPIÁ el nombre a su puesto base ('Ayudante') y poné 'Canalización' en el campo 'rama'. NO crees categorías nuevas para cada zona o rama. Utilizá el mismo 'categoria_id' base y guardá la rama/zona en escalas[].valores[].",

    draftName ? `Etiqueta informativa: ${draftName}.` : "Etiqueta informativa: sin etiqueta.",
    notes ? `Notas informativas: ${notes}.` : "Notas informativas: sin notas."
  ].join("\n");
}

function buildScaleCompactPrompt({ draftName, notes, baseCategories = [], baseConcepts = [] }) {
  const baseCategoriesText = baseCategories.length 
    ? `\nCATEGORÍAS PRE-EXTRAÍDAS: ${JSON.stringify(baseCategories.map(c => ({categoria_id: c.categoria_id, categoria_nombre: c.categoria_nombre})))}\nREGLA: Usa los 'categoria_id' de esta lista para mapear equivalencias. Si hay categorías nuevas en la tabla, extráelas también y crea nuevos IDs. Si una categoría ya existe en el CCT, volvé a emitirla en la escala con el mismo categoria_id. Si el documento usa rama, grupo, agrupamiento, sector o seccion, copiá ese texto en grupo_nombre y rama.` 
    : "";
  const baseConceptsText = baseConcepts.length
    ? `\nCONCEPTOS PRE-EXTRAÍDOS: ${JSON.stringify(baseConcepts.map(c => ({concepto_id: c.concepto_id, nombre: c.nombre})))}\nREGLA: Relaciona los adicionales o haberes de la tabla con estos 'concepto_id'. NO extraigas los adicionales como categorías y NO dupliques conceptos. Si el CCT ya trajo la formula_base de un concepto, conservála y usa la escala solo para el valor.`
    : "";
  return [
    "Extrae SOLO la escala salarial en JSON válido. Sé lo más exhaustivo posible para no perder filas ni categorías. No resumas la tabla." + baseCategoriesText + baseConceptsText,
    categoryHierarchyRulesForPrompt(),
    "Devuelve exclusivamente el contrato JSON sin notas ni explicaciones: {\"schemaVersion\":\"esueldos-cct-estructura-excel-v1\",\"convenio\":{},\"categorias\":[],\"escalas\":[]}.",
    "[AISLAMIENTO ABSOLUTO] Usa únicamente el texto de esta escala salarial. Si falta información usa null o [].",
    "Si el texto esta vacio o fragmentado, usa la vision del archivo original para recorrer todas las paginas y reconstruir la tabla. No inventes celdas ilegibles y marca su baja confianza.",
    
    // Directivas de Ultra-Compactación (Exclusivas de esta función)
    "Aplica estrictamente una matriz conceptual compacta: categoría x periodo x concepto x zona x modalidad. Cada importe va en escalas[].valores[].",
    "Conserva todos los periodos documentados, sin limitarte al año actual ni al ultimo mes.",
    "Si hay varios meses o tramos de vigencia, emití una escala separada por cada uno. No consolidés distintas vigencias en una sola escala.",
    "Si el PDF tiene anexos repetidos por mes y cada anexo trae bloques por rama, sector o grupo, emití una escala por cada bloque dentro de cada mes. No mezcles bloques distintos ni meses distintos en una sola escala.",
    "Cuando el documento repita la misma estructura por anexo, rama o bloque titular, conservá ese título en rama/grupo_nombre/alcance de la escala y tratá la zona solo como subdivisión de columnas. No conviertas la zona en categoría.",
    "Si el anexo incluye una suma no remunerativa mensual separada del básico, emitila como otro bloque de valores del mismo mes y rama, con su propio concepto_id no_remunerativo o equivalente, sin fusionarla con el sueldo básico.",
    "Cuando la tabla tenga columnas separadas por hora y mes, devolvé ambas como valores distintos: una fila/objeto con unidad_pago 'hourly' y otra con unidad_pago 'monthly'. No mezcles hora y mes en un solo valor.",
    "Si la tabla salarial tiene zonas en columnas o subcolumnas, registrá una fila por zona y llená 'zona' exactamente como aparece en el encabezado. No reutilices Zona A para otras columnas. Las zonas son subdivisiones de la misma categoría, no categorías nuevas.",
    "Si el OCR hace que varias columnas parezcan iguales, compará el encabezado completo antes de decidir la zona. La zona debe reflejar la columna real del PDF, no un valor repetido por defecto.",
    "Leé el encabezado de cada columna completo, incluyendo subencabezados como Personal con retiro, Personal sin retiro, Zona A, Zona B, Zona C, Austral u otros equivalentes. No tomes la primera zona visible como valor universal para toda la tabla.",
    "Cada ítem de 'valores' debe ser mínimo: categoria_id, concepto_id, periodicidad, valor. Agrega modalidad, unidad_pago, moneda o zona SOLO si cambia o es estrictamente indispensable para diferenciar la celda.",
    "Usa 'categoria_nombre' únicamente en el array raíz de categorías; NO repitas el nombre de la categoría dentro de cada objeto del vector de valores.",
    "No extraigas conceptos, adicionales, ámbitos ni deducciones en esta llamada. Esta función solo arma la malla salarial de categorías y valores.",
    
    // Clasificación y Tratamiento Rápido
    "SUELDO_BASICO: tipo_concepto haber, naturaleza remunerativo, base escala_salarial. NO_REMUNERATIVO: tipo_concepto haber, naturaleza no_remunerativo, base escala_salarial.",
    "El Sueldo Anual Complementario (SAC) no es SUELDO_BASICO. Si aparece en la tabla, crear concepto 'SAC' por separado.",
    "Si una categoría tiene importes separados por rama o zona visible en la tabla, NO crees categorías con IDs diferenciados en el listado raíz. Si el nombre del puesto tiene la rama pegada (ej: 'Ayudante Canalización'), LIMPIÁ el nombre a su puesto base ('Ayudante'). Generá un único 'categoria_id' general y apuntá cada importe en la matriz a ese ID, diferenciándolos usando los campos 'rama' o 'zona' en escalas[].valores[]. Las modalidades reales del puesto (ej: Con Retiro / Sin Retiro) SÍ deben generar categorías separadas si la tabla las lista como filas distintas.",
    "Reconstruye filas partidas del PDF: una categoría seguida por varias líneas de importes numéricos corresponden a la misma fila de la matriz.",
    "Formato numérico argentino obligatorio: el punto (.) son miles y la coma (,) son decimales.",

    draftName ? `Etiqueta usuario: ${draftName}.` : "Etiqueta usuario: sin etiqueta.",
    notes ? `Notas usuario: ${notes}.` : "Notas usuario: sin notas."
  ].join("\n");
}

function buildClassifierPrompt() {
  return [
    "Actuá como clasificador de documentos laborales argentinos.",
    "Tu tarea es analizar UN archivo cargado y determinar qué tipo de procesamiento corresponde aplicar. Clasifica por su contenido real, no por el nombre del archivo ni por el campo donde fue cargado.",
    "Si el archivo no tiene texto extraible, inspecciona visualmente sus paginas antes de marcarlo como no apto.",
    "Clasificá el documento en una de estas opciones:",
    "1. CCT_CONVENIO: Usar cuando el documento contiene reglas laborales, categorías, jornada, licencias, adicionales, aportes, contribuciones o condiciones generales de trabajo.",
    "2. ESCALA_SALARIAL: Usar cuando el documento contiene importes salariales, básicos, valores hora, jornales, sumas remunerativas, sumas no remunerativas, anexos salariales, planillas por mes, categoría, rama, zona o jornada.",
    "3. DOCUMENTO_MIXTO: Usar cuando el documento contiene reglas laborales y también importes salariales o escalas.",
    "4. HOMOLOGACION_COMPLEMENTARIA: Usar cuando el documento principalmente homologa, registra o aprueba un acuerdo, pero no contiene por sí mismo reglas ni importes suficientes para liquidar.",
    "5. DOCUMENTO_NO_APTO: Usar cuando el documento no permite extraer información útil para liquidación o está ilegible.",
    "6. REQUIERE_OCR: Usar cuando el documento es escaneado, imagen, tabla pegada como imagen o el texto no puede extraerse correctamente.",
    "Reglas:",
    "- Si hay artículos, jornada, licencias, categorías o adicionales sin montos, usar prompt CCT.",
    "- Si hay básicos, valores hora, jornales, importes, sumas no remunerativas o porcentajes de aumento, usar prompt escalas.",
    "- Si hay ambas cosas, usar ambos prompts.",
    "- Si solo hay una resolución de homologación sin anexo útil, marcar HOMOLOGACION_COMPLEMENTARIA.",
    "- Si el documento menciona una escala o anexo que no está incluido, marcar que requiere anexo.",
    "- No inventes datos.",
    "Devolvé únicamente JSON válido con esta estructura:",
    JSON.stringify({
      "clasificacion": "CCT_CONVENIO | ESCALA_SALARIAL | DOCUMENTO_MIXTO | HOMOLOGACION_COMPLEMENTARIA | DOCUMENTO_NO_APTO | REQUIERE_OCR",
      "usar_prompt_cct": true,
      "usar_prompt_escalas": true,
      "requiere_ocr": false,
      "requiere_revision_humana": false,
      "requiere_escala_anexa": false,
      "estado_extraccion": "COMPLETO | PARCIAL | INSUFICIENTE | DOCUMENTO_NO_APTO",
      "confianza_general": "alta | media | baja",
      "alertas": ["string"],
      "archivo_fuente": "string",
      "motivo": "Descripción de por qué se llegó a esta clasificación.",
      "datos_detectados": {
        "numero_cct": "string | null",
        "actividad": "string | null",
        "rama": "string | null",
        "periodos_salariales": ["string"],
        "hay_tablas": true,
        "hay_importes": true,
        "hay_reglas_laborales": true,
        "hay_anexos_mencionados": true
      },
      "accion_recomendada": "Ej: 'Usar prompt de CCT y luego el de escalas' o 'Aplicar OCR y volver a clasificar'."
    }, null, 2)
  ].join("\n");
}


module.exports = {
  universalConventionTemplateForPrompt,
  conventionExtractionContractForPrompt,
  buildConventionPrompt,
  buildConventionCorePrompt,
  buildScalePrompt,
  buildScaleCompactPrompt,
  buildClassifierPrompt,
  categoryHierarchyRulesForPrompt
};
