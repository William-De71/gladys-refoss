// -----------------------------------------------------------------------------
// Scene triggers and actions (manifest `scene_triggers`, `scene_actions`).
//
// Triggers: one event per transition, never a snapshot.
//
//   button_pressed       a push button wired on the input of an R11, R21 or
//                        P11S was pressed (single, double, triple, long): a
//                        wall switch that starts any scene, not only its relay
//   protection_tripped   the box cut or warns: overpower, overvoltage,
//                        overcurrent, undervoltage, overheating
//   device_offline       a box stopped answering for a minute
//   device_online        it answers again (after an offline event only)
//
// Actions: operations with parameters, which a device feature cannot carry.
//
//   switch_on_for        turn an outlet on for some minutes, then off (a
//                        pump, a towel rail); run again, it restarts the delay
//   read_energy          the counters of the box (today, this week, this
//                        month), to put in a message or compare in a scene
//
// No scene action fires an event: switching an outlet is not a button press.
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  BUTTON_PRESSED: 'button_pressed',
  PROTECTION_TRIPPED: 'protection_tripped',
  DEVICE_OFFLINE: 'device_offline',
  DEVICE_ONLINE: 'device_online',
};

// The data keys of each event, as declared in the manifest (fields and variables).
export const SCENE_TRIGGER_DATA = {
  [SCENE_TRIGGERS.BUTTON_PRESSED]: ['device', 'device_name', 'button', 'click'],
  [SCENE_TRIGGERS.PROTECTION_TRIPPED]: ['device', 'device_name', 'protection'],
  [SCENE_TRIGGERS.DEVICE_OFFLINE]: ['device_name', 'model', 'address'],
  [SCENE_TRIGGERS.DEVICE_ONLINE]: ['device_name', 'model', 'address'],
};

// Filter values: stored by the scenes, permanent.
export const CLICK_VALUES = ['single', 'double', 'triple', 'long'];
export const PROTECTION_VALUES = [
  'overpower',
  'overvoltage',
  'overcurrent',
  'undervoltage',
  'overtemp',
];

export const SCENE_ACTIONS = {
  SWITCH_ON_FOR: 'switch_on_for',
  READ_ENERGY: 'read_energy',
};

// The outputs each action returns, as declared in the manifest.
export const SCENE_ACTION_OUTPUTS = {
  [SCENE_ACTIONS.SWITCH_ON_FOR]: ['off_at'],
  [SCENE_ACTIONS.READ_ENERGY]: [
    'power_w',
    'today_kwh',
    'week_kwh',
    'month_kwh',
    'month_returned_kwh',
    'index_kwh',
  ],
};

export const MAX_MINUTES = 1440;
