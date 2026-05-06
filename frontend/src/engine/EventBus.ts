import mitt, { type Emitter } from "mitt";
import type { SyncEventMap } from "@bach-to-basics/shared";

// mitt's generic constraint requires Record<string | symbol, unknown>.
// We cast our typed map through a compatible intermediate type.
type BusEvents = SyncEventMap & Record<string | symbol, unknown>;

const bus = mitt<BusEvents>();

export type EventBus = Emitter<BusEvents>;
export default bus;
