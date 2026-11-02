type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type PreviousDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export type SettingsPath<T, Depth extends number = 10> =
    [Depth] extends [never] ? never
        : unknown extends T ? string
            : T extends Primitive ? never
                : T extends readonly (infer Item)[] ? `${number}` | `${number}.${SettingsPath<Item, PreviousDepth[Depth]>}`
                    : {[K in keyof T & string]-?: K | `${K}.${SettingsPath<NonNullable<T[K]>, PreviousDepth[Depth]>}`}[keyof T & string];

export type SettingsPathValue<T, P extends string> =
    unknown extends T ? unknown
        : P extends `${infer Head}.${infer Rest}` ? ChildValue<T, Head, Rest>
            : P extends keyof T ? T[P] | IndexMiss<T>
                : T extends readonly (infer Item)[] ? (P extends `${number}` ? Item | undefined : unknown)
                    : unknown;

export type SettingsDeepPartial<T> =
    T extends Primitive | readonly unknown[] ? T
        : T extends object ? {[K in keyof T]?: SettingsDeepPartial<T[K]>}
            : T;

export type SettingsEntries<T> = {[P in SettingsPath<T>]?: SettingsPathValue<T, P>};

export type SettingsPartialEntries<T> = {[P in SettingsPath<T>]?: SettingsDeepPartial<SettingsPathValue<T, P>>};

type ChildValue<T, Head extends string, Rest extends string> =
    Head extends keyof T ? SettingsPathValue<NonNullable<T[Head]>, Rest> | (T[Head] extends NonNullable<T[Head]> ? IndexMiss<T> : undefined)
        : T extends readonly (infer Item)[] ? (Head extends `${number}` ? SettingsPathValue<Item, Rest> | undefined : unknown)
            : unknown;

type IndexMiss<T> = string extends keyof T ? undefined : never;
