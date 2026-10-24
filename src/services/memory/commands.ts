import {
  deleteTravelerMemoryInputSchema,
  disableTravelerMemoryInputSchema,
  getTravelerMemoryInputSchema,
  successEnvelope,
  updateTravelerMemoryInputSchema,
} from "@/skill/contracts";
import { status } from "@/skill/runtime-helpers";
import { PreferenceMemoryStore } from "@/services/memory/preferences";

export interface MemoryCommandDeps {
  dataRoot: string;
}

const storeFor = (deps: MemoryCommandDeps) => new PreferenceMemoryStore(deps.dataRoot);

export async function getTravelerMemoryCommand(raw: unknown, deps: MemoryCommandDeps) {
  getTravelerMemoryInputSchema.parse(raw);
  const store = storeFor(deps);
  const memory = await store.read();
  const disclosure = await store.summaryLine();
  return successEnvelope(
    { memory, disclosure },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

export async function updateTravelerMemoryCommand(raw: unknown, deps: MemoryCommandDeps) {
  const input = updateTravelerMemoryInputSchema.parse(raw);
  const store = storeFor(deps);
  for (const entry of input.entries) {
    await store.setExplicit(entry.key, entry.value, entry.source);
  }
  const memory = await store.read();
  return successEnvelope(
    { memory, disclosure: await store.summaryLine() },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

export async function deleteTravelerMemoryCommand(raw: unknown, deps: MemoryCommandDeps) {
  const input = deleteTravelerMemoryInputSchema.parse(raw);
  const store = storeFor(deps);
  const memory = await store.remove(input.key);
  return successEnvelope(
    { memory, disclosure: await store.summaryLine(), deletedKey: input.key },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

export async function disableTravelerMemoryCommand(raw: unknown, deps: MemoryCommandDeps) {
  const input = disableTravelerMemoryInputSchema.parse(raw);
  const store = storeFor(deps);
  const memory = await store.setDisabled(input.disabled);
  return successEnvelope(
    { memory, disclosure: await store.summaryLine(), disabled: Boolean(memory.disabledAt) },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}
