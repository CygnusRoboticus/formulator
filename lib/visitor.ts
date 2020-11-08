import { tuple } from "fp-ts/lib/function";
import { combineLatest } from "rxjs";
import { first, map } from "rxjs/operators";
import { ArrayConfig, FieldConfig, GroupConfig, ItemConfig } from "./configs";
import { ArrayControl, FieldControl, GroupControl, ItemControl, KeyValueControls } from "./controls";
import {
  AbstractExtras,
  AbstractHints,
  Disabler,
  Extraer,
  Hinter,
  ObservableExecutor,
  Trigger,
  Validator,
} from "./controls.types";
import { Executable, ExecutableDefinition, FuzzyExecutableRegistry, SearchResolver } from "./executable";
import { BaseGroupConfig, BaseItemConfig } from "./primitives";
import { FieldTypeMap, FormControls, FormValue } from "./typing";
import { isArrayConfig, isFieldConfig, isGroupConfig, notNullish, toObservable } from "./utils";

export interface Visitor<
  TConfig extends BaseItemConfig,
  TRegistry extends FuzzyExecutableRegistry,
  THints extends AbstractHints,
  TExtras extends AbstractExtras
> {
  itemInit: (
    config: ItemConfig<TRegistry, THints, TExtras> & TConfig,
    children: ItemControl<THints, TExtras>[],
  ) => ItemControl<THints, TExtras>;
  fieldInit: (
    config: FieldConfig<TRegistry, THints, TExtras> & TConfig,
    value?: any,
  ) => FieldControl<{}, THints, TExtras>;
  groupInit: (
    config: GroupConfig<TConfig, TRegistry, THints, TExtras> & TConfig,
    bundled: KeyValueControls<{}, THints, TExtras>,
    children: ItemControl<THints, TExtras>[],
  ) => GroupControl<{}, {}, THints, TExtras>;
  arrayInit: (
    config: ArrayConfig<TConfig, TRegistry, THints, TExtras> & TConfig,
    bundled: KeyValueControls<{}, THints, TExtras>,
    value?: any,
  ) => ArrayControl<{}, {}, THints, TExtras>;

  itemComplete: (
    control: ItemControl<THints, TExtras>,
    config: ItemConfig<TRegistry, THints, TExtras> & TConfig,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) => void;
  fieldComplete: (
    control: FieldControl<TRegistry, THints, TExtras>,
    config: FieldConfig<TRegistry, THints, TExtras> & TConfig,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) => void;
  groupComplete: (
    control: GroupControl<{}, {}, THints, TExtras>,
    config: GroupConfig<TConfig, TRegistry, THints, TExtras> & FieldConfig<TRegistry, THints, TExtras> & TConfig,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) => void;
  arrayComplete: (
    control: ArrayControl<{}, {}, THints, TExtras>,
    config: ArrayConfig<TConfig, TRegistry, THints, TExtras>,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) => void;
}

class DefaultVisitor<
  TConfig extends BaseItemConfig,
  TRegistry extends FuzzyExecutableRegistry,
  THints extends AbstractHints,
  TExtras extends AbstractExtras
> implements Visitor<TConfig, TRegistry, THints, TExtras> {
  itemInit(config: ItemConfig<TRegistry, THints, TExtras> & TConfig) {
    return new ItemControl<THints, TExtras>();
  }
  fieldInit(config: FieldConfig<TRegistry, THints, TExtras> & TConfig, value?: any) {
    return new FieldControl<any, THints, TExtras>(value ?? null);
  }
  groupInit(
    config: GroupConfig<TConfig, TRegistry, THints, TExtras> & TConfig,
    bundled: KeyValueControls<{}, THints, TExtras>,
  ) {
    return new GroupControl<{}, {}, THints, TExtras>(bundled);
  }
  arrayInit(
    config: ArrayConfig<TConfig, TRegistry, THints, TExtras> & TConfig,
    bundled: KeyValueControls<{}, THints, TExtras>,
    value?: any[],
  ) {
    return new ArrayControl<{}, {}, THints, TExtras>(
      () => new GroupControl<{}, {}, THints, TExtras>(bundled),
      value ?? [],
    );
  }

  itemComplete(
    control: ItemControl<THints, TExtras>,
    config: ItemConfig<TRegistry, THints, TExtras> & TConfig,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) {
    this.initItem(control, parent, config, registry);
  }
  fieldComplete(
    control: FieldControl<TRegistry, THints, TExtras>,
    config: FieldConfig<TRegistry, THints, TExtras> & TConfig,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) {
    this.initField(control, parent, config, registry);
  }
  groupComplete(
    control: GroupControl<{}, {}, THints, TExtras>,
    config: GroupConfig<TConfig, TRegistry, THints, TExtras> & FieldConfig<TRegistry, THints, TExtras> & TConfig,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) {
    this.initField(control, parent, config, registry);
  }
  arrayComplete(
    control: ArrayControl<{}, {}, THints, TExtras>,
    config: ArrayConfig<TConfig, TRegistry, THints, TExtras>,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    root: GroupControl<{}, {}, THints, TExtras>,
    registry: TRegistry,
  ) {
    this.initField(control, parent, config, registry);
  }

  initItem(
    control: ItemControl<THints, TExtras>,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    config: ItemConfig<TRegistry, THints, TExtras>,
    registry: TRegistry,
  ) {
    const hints = Object.entries(config.hints ?? {}).reduce((acc, [key, value]) => {
      const sources = getRegistryValues<
        typeof registry,
        typeof config,
        typeof control,
        ObservableExecutor<typeof control, boolean>,
        THints,
        TExtras
      >(registry, "hints", config, control, value as any).map(s => (c: ItemControl<THints, TExtras>) =>
        toObservable(s(c)).pipe(map(v => [key, v] as [keyof THints, boolean])),
      );
      acc.push(...sources);
      return acc;
    }, <Hinter<ItemControl<THints, TExtras>, THints>[]>[]);

    const extrasSource = Object.entries(config.extras ?? {}).reduce((acc, [key, value]) => {
      const source = getRegistryValue<
        typeof registry,
        typeof config,
        typeof control,
        ObservableExecutor<ItemControl<THints, TExtras>, TExtras[keyof TExtras]>,
        THints,
        TExtras
      >(registry, "extras", config, control, value as any);
      if (source) {
        acc.push([key, source]);
      }
      return acc;
    }, <[keyof TExtras, ObservableExecutor<ItemControl<THints, TExtras>, TExtras[keyof TExtras]>][]>[]);
    const extras = (c: ItemControl<THints, TExtras>) => {
      return combineLatest(extrasSource.map(([k, s]) => toObservable(s(c)).pipe(map(v => tuple(k, v))))).pipe(
        map(values =>
          values.reduce((acc, [k, v]) => {
            acc[k] = v;
            return acc;
          }, <Partial<TExtras>>{}),
        ),
      );
    };

    const messages = getRegistryValues<
      typeof registry,
      typeof config,
      typeof control,
      Validator<typeof control>,
      THints,
      TExtras
    >(registry, "messagers", config, control, (config.messagers ?? []) as any);

    control.setHinters(hints);
    control.setExtraers(extras);
    control.setMessagers(messages);

    if (!control.parent && parent) {
      control.setParent(parent);
    }
  }

  initField(
    control: FieldControl<any, THints, TExtras>,
    parent: GroupControl<{}, {}, THints, TExtras> | null,
    config: FieldConfig<TRegistry, THints, TExtras>,
    registry: TRegistry,
  ) {
    this.initItem(control, parent, config, registry);

    const disablers = getRegistryValues<
      typeof registry,
      typeof config,
      typeof control,
      Disabler<typeof control>,
      THints,
      TExtras
    >(registry, "hints", config, control, config.disablers ?? ([] as any));

    const validators = getRegistryValues<
      typeof registry,
      typeof config,
      typeof control,
      Validator<typeof control>,
      THints,
      TExtras
    >(registry, "validators", config, control, config.validators ?? ([] as any));

    const triggers = getRegistryValues<
      typeof registry,
      typeof config,
      typeof control,
      Trigger<typeof control>,
      THints,
      TExtras
    >(registry, "triggers", config, control, config.triggers ?? ([] as any));

    control.setDisablers(disablers);
    control.setTriggers(triggers);
    control.setValidators(validators);
  }
}

export interface ConfigBundle<
  T extends TConfig,
  TControl extends ItemControl<THints, TExtras>,
  TConfig extends BaseItemConfig,
  TRegistry extends FuzzyExecutableRegistry = FuzzyExecutableRegistry,
  THints extends AbstractHints = AbstractHints,
  TExtras extends AbstractExtras = AbstractExtras
> {
  id: string;
  registry: TRegistry;
  control: TControl;
  config: T;
  children: ConfigBundle<TConfig, ItemControl<THints, TExtras>, TConfig, TRegistry, THints, TExtras>[];
}

export function bundleConfig<
  T extends TConfig & BaseGroupConfig<TConfig>,
  TConfig extends BaseItemConfig,
  TTypes extends FieldTypeMap<TConfig, TS, TN, TB, TArray, TNull>,
  TRegistry extends FuzzyExecutableRegistry,
  THints extends AbstractHints = AbstractHints,
  TExtras extends AbstractExtras = AbstractExtras,
  TValue = FormValue<T["fields"], TConfig, TTypes>,
  TS = unknown,
  TN = unknown,
  TB = unknown,
  TArray = unknown,
  TNull = unknown
>(
  config: T,
  registry: TRegistry,
  value?: TValue,
  visitor: Visitor<TConfig, TRegistry, THints, TExtras> = new DefaultVisitor<TConfig, TRegistry, THints, TExtras>(),
) {
  const bundle = bundleConfig2<
    GroupControl<
      // @ts-ignore
      TValue,
      FormControls<T["fields"], TConfig, TTypes, THints, TExtras>,
      THints,
      TExtras
    >,
    TConfig,
    TRegistry,
    THints,
    TExtras
  >(config.type, config, value, registry, visitor);
  completeConfig2(bundle, null, bundle, registry, visitor);
  return bundle;
}

export function getRegistryMethods<
  TRegistry extends FuzzyExecutableRegistry,
  TValue,
  THints extends AbstractHints = AbstractHints,
  TExtras extends AbstractExtras = AbstractExtras
>(registry: TRegistry, kind: keyof TRegistry, defs: readonly ExecutableDefinition<TRegistry[typeof kind], TValue>[]) {
  return defs
    .map(def => {
      const method = getRegistryMethod<TRegistry, TValue, THints, TExtras>(registry, kind, def);
      return method ? { method, def } : null;
    })
    .filter(notNullish);
}

export function getRegistryMethod<
  TRegistry extends FuzzyExecutableRegistry,
  TValue,
  THints extends AbstractHints = AbstractHints,
  TExtras extends AbstractExtras = AbstractExtras
>(
  registry: TRegistry,
  kind: keyof TRegistry,
  def: ExecutableDefinition<TRegistry[typeof kind], TValue>,
): Executable<BaseItemConfig, ItemControl<THints, TExtras>, any, TValue, THints, TExtras> | null {
  const method = (registry[kind] as any)?.[def.name];
  if (method && registry[kind]) {
    return method.bind(registry[kind]);
  }
  return null;
}

export function getRegistryValues<
  TRegistry extends FuzzyExecutableRegistry,
  TConfig extends BaseItemConfig,
  TControl extends ItemControl<THints, TExtras>,
  TValue,
  THints extends AbstractHints = AbstractHints,
  TExtras extends AbstractExtras = AbstractExtras
>(
  registry: TRegistry,
  kind: keyof TRegistry,
  config: TConfig,
  control: TControl,
  defs: readonly ExecutableDefinition<TRegistry[typeof kind], TValue>[],
): TValue[] {
  const methods = getRegistryMethods<TRegistry, TValue, THints, TExtras>(registry, kind, defs);
  return methods.map(({ method, def }) => method(config, control, (def as any).params));
}

export function getRegistryValue<
  TRegistry extends FuzzyExecutableRegistry,
  TConfig extends BaseItemConfig,
  TControl extends ItemControl<THints, TExtras>,
  TValue,
  THints extends AbstractHints = AbstractHints,
  TExtras extends AbstractExtras = AbstractExtras
>(
  registry: TRegistry,
  kind: keyof TRegistry,
  config: TConfig,
  control: TControl,
  def: ExecutableDefinition<TRegistry[typeof kind], TValue>,
): TValue | null {
  const method = getRegistryMethod<TRegistry, TValue, THints, TExtras>(registry, kind, def);
  return method ? method(config, control, (def as any).params) : null;
}

function completeConfig2<
  TConfig extends BaseItemConfig,
  TRegistry extends FuzzyExecutableRegistry,
  THints extends AbstractHints,
  TExtras extends AbstractExtras
>(
  bundle: ConfigBundle<TConfig, ItemControl<THints, TExtras>, TConfig, TRegistry, THints, TExtras>,
  parentBundle: ConfigBundle<
    TConfig,
    GroupControl<any, any, THints, TExtras>,
    TConfig,
    TRegistry,
    THints,
    TExtras
  > | null,
  rootBundle: ConfigBundle<TConfig, GroupControl<any, any, THints, TExtras>, TConfig, TRegistry, THints, TExtras>,
  registry: TRegistry,
  visitor: Visitor<TConfig, TRegistry, THints, TExtras>,
) {
  const { config, control, children } = bundle;
  children.forEach(c =>
    completeConfig2(
      c,
      bundle as ConfigBundle<TConfig, GroupControl<any, any, THints, TExtras>, TConfig, TRegistry, THints, TExtras>,
      rootBundle,
      registry,
      visitor,
    ),
  );

  if (isFieldConfig<TConfig>(config)) {
    if (isArrayConfig<TConfig>(config) && control instanceof FieldControl) {
      visitor.arrayComplete(control as any, config as any, parentBundle?.control ?? null, rootBundle.control, registry);
    } else if (isGroupConfig<TConfig>(config) && control instanceof GroupControl) {
      visitor.groupComplete(control, config as any, parentBundle?.control ?? null, rootBundle.control, registry);
    } else if (control instanceof FieldControl) {
      visitor.fieldComplete(control, config as any, parentBundle?.control ?? null, rootBundle.control, registry);
    }
  }
  visitor.itemComplete(control, config as any, parentBundle?.control ?? null, rootBundle.control, registry);
}

function bundleConfig2<
  TControl extends ItemControl<THints, TExtras>,
  TConfig extends BaseItemConfig,
  TRegistry extends FuzzyExecutableRegistry,
  THints extends AbstractHints,
  TExtras extends AbstractExtras
>(
  id: string,
  config: TConfig,
  value: any | undefined,
  registry: TRegistry,
  visitor: Visitor<TConfig, TRegistry, THints, TExtras>,
): ConfigBundle<TConfig, TControl, TConfig, TRegistry, THints, TExtras> {
  if (isGroupConfig<TConfig>(config)) {
    const items = config.fields.map((f, i) => {
      if (isFieldConfig<TConfig>(f)) {
        const bundle = bundleConfig2<ItemControl<THints, TExtras>, TConfig, TRegistry, THints, TExtras>(
          `${id}-${f.name}`,
          f,
          value?.[f.name],
          registry,
          visitor,
        );
        return { controls: { [f.name]: bundle.control }, config: f, items: [bundle] };
      } else if (isGroupConfig<TConfig>(f)) {
        const bundle = bundleConfig2<ItemControl<THints, TExtras>, TConfig, TRegistry, THints, TExtras>(
          `${id}-${i}`,
          { ...f, name: "group" },
          value,
          registry,
          visitor,
        );
        return {
          controls: {
            ...(bundle.control as GroupControl<{}, {}, THints, TExtras>).controls,
          },
          config: f,
          items: [bundle],
        };
      }
      const bundle = bundleConfig2<ItemControl<THints, TExtras>, TConfig, TRegistry, THints, TExtras>(
        `${id}-${i}`,
        f,
        value,
        registry,
        visitor,
      );
      return { controls: {}, config: f, items: [bundle] };
    });

    const controls = items.reduce((acc, f) => ({ ...acc, ...f.controls }), {});
    const children = items.reduce((acc, f) => [...acc, ...f.items], <typeof items[0]["items"]>[]);

    if (isArrayConfig<TConfig>(config)) {
      const control = visitor.arrayInit(config as any, controls, value);
      return {
        id: `${id}-${config.name}`,
        registry,
        config,
        control: control as any,
        children,
      };
    } else if (isFieldConfig<TConfig>(config)) {
      const control = visitor.groupInit(
        config as any,
        controls,
        children.map(c => c.control),
      );
      return {
        id: `${id}-${config.name}`,
        registry,
        config,
        control: control as any,
        children,
      };
    } else {
      const control = visitor.itemInit(
        config as any,
        children.map(c => c.control),
      );
      return {
        id: `${id}-${config.type}`,
        registry,
        config,
        control: control as any,
        children,
      };
    }
  } else if (isFieldConfig<TConfig>(config)) {
    const control = visitor.fieldInit(config as any, value);
    return {
      id: `${id}-${config.name}`,
      registry,
      config,
      control: control as any,
      children: [],
    };
  }

  const control = visitor.itemInit(config as any, []);
  return {
    id: `${id}-${config.type}`,
    registry,
    config,
    control: control as any,
    children: [],
  };
}
