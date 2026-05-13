# Especificación corregida: Gestor de presupuestos con distribución por fuente

## 1) Objetivo
Construir un sistema de presupuestos **jerárquico** donde:
- Cada **fuente de ingreso** (ej. Beca INA, Salario CINDEA) tiene su propia distribución por categorías.
- Las **categorías** se visualizan de forma **centralizada** sumando aportes de todas las fuentes.
- El usuario puede bajar a detalle por categoría y por fuente para entender asignación, gasto y saldo.

---

## 2) Modelo conceptual

### Entidades principales

#### FuenteIngreso
- `id`
- `nombre` (ej. "Beca INA")
- `montoTotal`
- `fechaEntradaEsperada`
- `estado` (`pendiente` | `recibido`)
- `distribuciones[]` (lista de montos por categoría)

#### Categoria
- `id`
- `nombre` (ej. Alimentación, Mascotas, Transporte, Ahorro)
- `icono` (opcional)

#### DistribucionFuenteCategoria
Relaciona cuánto de una fuente se asigna a una categoría:
- `id`
- `fuenteId`
- `categoriaId`
- `montoAsignado`

#### Gasto
- `id`
- `fuenteId` (**obligatorio**: de cuál ingreso sale)
- `categoriaId`
- `monto`
- `descripcion`
- `fecha`

---

## 3) Reglas de negocio

1. **Validación de distribución por fuente**
   - La suma de `montoAsignado` de una fuente **no puede exceder** `montoTotal` de la fuente.
   - `montoSinAsignar = montoTotal - sumaDistribucionesFuente`.

2. **Cálculo centralizado por categoría**
   - `totalAsignadoCategoria = suma(montoAsignado en todas las fuentes para esa categoría)`.
   - `gastoCategoria = suma(gastos de la categoría en todas las fuentes)`.
   - `disponibleCategoria = totalAsignadoCategoria - gastoCategoria`.

3. **Registro de gasto obligatorio por fuente y categoría**
   - Cada gasto descuenta simultáneamente:
     - del acumulado de la **fuente** indicada,
     - del acumulado de la **categoría** indicada.

4. **Desglose por categoría y fuente**
   - Para una categoría (ej. Alimentación), debe verse el detalle por fuente:
     - asignado por fuente,
     - gastado por fuente,
     - disponible por fuente,
     - total consolidado.

5. **Resumen financiero general**
   - `ingresosTotales = suma(montoTotal de fuentes)`.
   - `dineroDistribuido = suma(todas las distribuciones)`.
   - `dineroSinAsignar = ingresosTotales - dineroDistribuido`.
   - `gastoTotalAcumulado = suma(todos los gastos)`.

---

## 4) Funcionalidades principales

### 4.1 Gestión de fuentes de ingreso
- Crear fuente con nombre, monto, fecha esperada y estado.
- Editar y eliminar fuente.
- Ver % distribuido y monto sin asignar por fuente.
- Acción "editar distribución" por fuente.

### 4.2 Distribución por categorías dentro de cada fuente
- Asignar montos por categoría en una fuente.
- Validación en tiempo real para no exceder monto total de la fuente.
- Mostrar monto sin asignar (en rojo si hay saldo pendiente de asignar).

### 4.3 Categorías (vista centralizada)
Para cada categoría mostrar:
- Total asignado (sumado de todas las fuentes).
- Gasto actual.
- Disponible.
- Barra de progreso (`gasto / totalAsignado`).
- Botón/icono de "ver desglose por fuente".

### 4.4 Desglose por fuente (submenú de categoría)
- Lista de fuentes que aportan a esa categoría.
- Por cada fuente:
  - asignado,
  - gastado,
  - disponible.
- Total consolidado al final.
- Historial de gastos de esa categoría con etiqueta de fuente.

### 4.5 Registro de gastos
- Formulario con:
  - fuente,
  - categoría,
  - monto,
  - descripción,
  - fecha.
- Actualización automática de saldos por fuente y categoría.

### 4.6 Dashboard central

#### Panel de fuentes
- Tarjetas por fuente:
  - nombre,
  - monto total,
  - % distribuido,
  - monto sin asignar,
  - botón "editar distribución".

#### Panel de categorías (principal)
- Listado centralizado por categoría con totales consolidados.

#### Resumen financiero
- ingresos totales,
- dinero distribuido,
- dinero sin asignar,
- gasto acumulado,
- meta de ahorro vs ahorro actual.

#### Gráficos
- Pastel: distribución por categoría.
- Barras: gasto vs límite por categoría.
- Barras apiladas o heatmap: aporte por fuente a cada categoría.

### 4.7 Vista detallada de una fuente
Al abrir una fuente (ej. Beca INA):
- Distribución completa por categoría dentro de la fuente.
- Gastado/disponible por categoría dentro de esa fuente.
- Historial de gastos filtrable por categoría.

### 4.8 Calculador de ahorro (opcional)
- Cuestionario de meta mensual y gastos esperados.
- Sugerencia automática de distribución inicial por fuente/categoría.
- Ajuste manual posterior antes de guardar.

---

## 5) Flujo de usuario esperado
1. Crear fuentes de ingreso (ej. Beca INA, Salario CINDEA).
2. Entrar a cada fuente y distribuir montos por categorías.
3. Ir al dashboard y ver consolidado por categoría.
4. Registrar gastos indicando fuente + categoría.
5. Explorar desgloses:
   - por categoría (quién aporta y cuánto),
   - por fuente (cómo se distribuye y en qué se gasta).

---

## 6) Casos de uso clave

### Caso A: Categoría centralizada
- Alimentación:
  - Beca INA: 50,000
  - Salario CINDEA: 30,000
  - Total categoría: 80,000

### Caso B: Gasto registrado
- Gasto de 5,000 en Alimentación desde Beca INA:
  - baja disponible en Beca INA,
  - sube gasto de Alimentación consolidado,
  - baja disponible de Alimentación consolidado.

### Caso C: Fuente detallada
- Beca INA muestra su distribución interna completa y su historial de gastos.

---

## 7) Criterios de aceptación
- [ ] Se pueden crear múltiples fuentes con estado y fecha esperada.
- [ ] Cada fuente permite distribución por categoría con validación de tope.
- [ ] Las categorías muestran montos consolidados automáticamente.
- [ ] Cada categoría permite abrir desglose por fuente.
- [ ] Todo gasto exige fuente + categoría y actualiza ambas vistas.
- [ ] El dashboard muestra resumen financiero global consistente.
- [ ] La vista detallada de fuente muestra distribución + historial filtrable.

---

## 8) Nota de implementación recomendada
Para minimizar inconsistencias:
- Guardar distribución a nivel de relación `fuente-categoría`.
- Calcular agregados por consultas (o vistas/materializaciones) en lugar de duplicar totales.
- Centralizar reglas de validación de topes y disponibilidad en una capa de dominio/servicio.
