/**
 * dsh-read-aloud — host half.
 *
 * Pure client plugin: there is nothing to do on the host side, so `apply` is
 * an empty implementation that keeps the package a valid Cordis plugin. All
 * behavior lives in lib/client.js (the browser half, hand-written bundle).
 */

export const name = "dsh-read-aloud";

export const inject = [];

export function apply() {
  // The browser half owns every behavior; the host half exists only so the
  // package appears as a mountable Cordis row.
}
