# Refoss

## Presentación

Esta integración lleva tus dispositivos Refoss a Gladys, en tu red local y sin la nube de Refoss: el enchufe inteligente P11S, los relés y módulos de persiana R10, R11 y R21, y los medidores de energía EM01P, EM06, EM06P, EM16 y EM16P con sus pinzas amperimétricas.

Cada toma, persiana y pinza se convierte en un dispositivo de Gladys que puedes controlar, asignar a una habitación, usar en escenas y añadir al seguimiento energético de Gladys: la integración convierte los contadores de los dispositivos, que se reinician cada mes, en índices de energía que solo suben.

Sin relación con Refoss.

![El widget «Dispositivo Refoss» de la pinza de una bomba de calor junto a la vista general «Potencia Refoss» (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-refoss/main/docs/assets/widgets.es.png)

## Requisitos

- Gladys Assistant 5.1.0 o posterior.
- Tus dispositivos Refoss configurados en la app Refoss y conectados a la misma red que Gladys.
- Para los primeros modelos (R10, EM06, EM16): una dirección IP fija, definida como reserva DHCP en tu router.
- Si has protegido tus dispositivos con una contraseña en la app Refoss: esa contraseña.

## Configuración

### Dispositivos

Los modelos actuales (P11S, R11, R21, EM01P, EM06P, EM16P) se encuentran solos: acepta el descubrimiento de red al instalar la integración y pulsa **Buscar los dispositivos**.

Gladys no puede encontrar los primeros modelos (R10, EM06, EM16): escribe sus direcciones IP en **Direcciones de los modelos antiguos**, separadas por comas. También puedes escribir la dirección de un modelo actual que esté en otra subred.

**Contraseña de los dispositivos**: solo si definiste una en la app Refoss (la misma para todos tus dispositivos). Si no, déjala vacía.

### Actualización e idioma

**Actualización de las medidas**: cada cuánto se envían a Gladys la potencia, la tensión, la corriente y la energía (10, 30 o 60 segundos); el encendido / apagado y las persianas se envían siempre al momento. **Volver a buscar**: cada cuánto se busca en la red si hay dispositivos nuevos. **Idioma de los nombres de dispositivos**: el idioma de los nombres de las funciones y de los mensajes de error de las escenas.

## Uso

### Dispositivos

Abre la **pestaña Descubrir** de la integración y añade los dispositivos que quieras. Hay un dispositivo de Gladys por canal:

- una **toma o un relé**: encendido / apagado y, cuando el dispositivo los mide, potencia, tensión, corriente y un índice de energía;
- una **persiana** (R11 o R21 en modo persiana): abrir, parar, cerrar, y la posición una vez calibrado el motor en la app Refoss;
- una **pinza** de un medidor de energía: potencia (por debajo de cero cuando la línea devuelve energía, por ejemplo una línea solar), tensión, corriente, energía consumida y energía devuelta.

Los nombres vienen de la app Refoss; una pinza sin nombre recibe el de su caja y su posición (`A1`, `B1`…).

### Seguimiento energético

La función **Energía consumida** de una toma o de una pinza es un índice en kWh que solo sube: añade el dispositivo al seguimiento energético de Gladys para ver su consumo diario y su coste. La función **Energía devuelta** de una pinza sigue lo que ha devuelto. El índice empieza el día en que añades el dispositivo.

### Widgets

- **Potencia Refoss**: todas las tomas, pinzas y persianas de un vistazo, de la que más consume a la que menos, con su energía del mes, y los dispositivos que no responden.
- **Dispositivo Refoss**: una toma, pinza o persiana con su potencia en directo, el consumo de hoy y de este mes, su curva de potencia de las últimas 24 horas y sus botones.

### Escenas

Disparadores: **Se pulsa un botón de un dispositivo Refoss** (pulsación simple, doble, triple o larga en la entrada de un R11, R21 o P11S), **Salta una protección Refoss** (sobrepotencia, sobretensión, sobrecorriente, subtensión, sobrecalentamiento), **Se pierde un dispositivo Refoss**, **Vuelve un dispositivo Refoss**.

Acciones: **Encender un enchufe Refoss un rato** (se apaga al cabo de ese tiempo, incluso tras un reinicio), **Leer la energía de un dispositivo Refoss** (potencia, hoy, esta semana, este mes, devuelta, índice).

Ejemplos:

- Una doble pulsación en el botón del pasillo → apagar todas las luces.
- Salta una protección en el enchufe del horno → enviar una notificación.
- Todas las noches → leer la energía de la bomba de calor y enviarla en un mensaje.

## Solución de problemas

- **No se encuentra un dispositivo**: comprueba que la app Refoss llega a él en la misma Wi-Fi que Gladys y que tu red deja pasar el mDNS, o escribe su dirección. Un R10, EM06 o EM16 siempre necesita su dirección.
- **«protegido con contraseña»**: escribe la contraseña de la app Refoss en la configuración.
- **Una pinza cuenta el consumo como energía devuelta**: dale la vuelta a la pinza (la flecha que lleva indica el sentido).
- **«Gladys rechazó la búsqueda en la red»**: reinstala la integración y acepta su descubrimiento de red.
- El botón **Buscar los dispositivos** lista lo que ve la integración; la pestaña Registros de la integración da más detalles.

Informa de un problema en [GitHub](https://github.com/William-De71/gladys-refoss/issues) indicando tu versión de Gladys, la versión de la integración, el modelo del dispositivo y los registros.
