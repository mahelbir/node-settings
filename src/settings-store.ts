export type SettingsData = Record<string, unknown>;

export type SettingsUpdater = (current: unknown) => Promise<SettingsData>;

export interface SettingsStore {
    read(): Promise<unknown>;
    update(updater: SettingsUpdater): Promise<void>;
}
