import { Events } from "@antelopejs/interface-core/modules";

let stopping = false;

/**
 * Follows the core's lifecycle: set when the modules start to stop, cleared
 * when they have started again, so a reload that keeps this module loaded
 * does not leave it refusing work.
 */
export function trackModulesStopping(): void {
  Events.ModulesStopping.register(() => {
    stopping = true;
  });
  Events.ModulesStarted.register(() => {
    stopping = false;
  });
}

/** Whether the core has begun stopping the modules and has not restarted them. */
export function isModulesStopping(): boolean {
  return stopping;
}
