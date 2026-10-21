import type { ComponentAdapter, ComponentEnvironment } from "./component.ts";

/** The small structural API the adapter needs; pass an optional ECharts module via load. */
export interface EChartsRuntime {
  /** Creates one SVG chart. Locale packs are registered by the application loader. */
  init(node: HTMLElement, theme?: undefined, options?: { renderer: "svg"; locale: string; devicePixelRatio: number }): EChartsInstance;
}

/** Public ECharts methods used by the reference adapter. */
export interface EChartsInstance {
  /** Updates chart options without publishing synthetic selection events. */
  setOption(option: object, options: { notMerge: boolean; silent: boolean; replaceMerge?: string[] }): void;
  /** Resizes internal chart rendering to observed CSS dimensions. */
  resize(options: { width: number; height: number; silent: boolean }): void;
  /** Attaches the adapter's pointer action callback. */
  on(event: "click", listener: (event: unknown) => void): void;
  /** Removes the same callback before disposing. */
  off(event: "click", listener: (event: unknown) => void): void;
  /** Releases vendor-owned rendering and event resources. */
  dispose(): void;
}

/** Configuration stays in the application; no ECharts dependency ships in the elements package. */
export interface EChartsAdapterOptions {
  /** Lazy module load. Register any modular charts/components before returning it. */
  readonly load: () => Promise<EChartsRuntime>;
  /** Reads public data signals; must return a complete option, including empty/loading states. */
  readonly option: (environment: ComponentEnvironment) => Readonly<Record<string, unknown>>;
  /** Merge stable named series/data for incremental transitions; omitted option fields are retained. Default replace. */
  readonly updateMode?: "replace" | "merge";
  /** Explicit mapping of vendor events to public data actions; no implicit record/index mapping. */
  readonly click?: (event: unknown) => void;
}

/** CSS colours resolved to sRGB for vendor parsers that don't understand modern CSS colours. */
export function echartsColors(environment: ComponentEnvironment): ComponentEnvironment["theme"] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const colour = (value: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${a! / 255})`;
  };
  const theme = environment.theme;
  return { surface: colour(theme.surface), text: colour(theme.text), muted: colour(theme.muted), rule: colour(theme.rule), accent: colour(theme.accent), positive: colour(theme.positive), negative: colour(theme.negative) };
}

/** ECharts reference lifecycle: stable SVG, reactive options, silent updates and exact disposal. */
export function echartsAdapter(options: EChartsAdapterOptions): ComponentAdapter {
  return {
    async mount({ node, signal, environment }) {
      const runtime = await options.load();
      if (signal.aborted) return { update() {}, dispose() {} };
      let chart: EChartsInstance | undefined;
      let locale = environment.locale;
      const click = (event: unknown) => { if (!signal.aborted) options.click?.(event); };
      const dispose = () => {
        const owned = chart; chart = undefined;
        if (!owned) return;
        try { owned.off("click", click); }
        finally { owned.dispose(); }
      };
      const init = (current: ComponentEnvironment) => {
        chart = runtime.init(node, undefined, { renderer: "svg", locale: current.locale, devicePixelRatio: current.pixelRatio });
        try { chart.on("click", click); }
        catch (error) { dispose(); throw error; }
        locale = current.locale;
      };
      init(environment);
      let previous: ComponentEnvironment | undefined;
      let previousMotion: boolean | undefined;
      return {
        update(current) {
          // Read data while hidden too, so showing the component uses the latest state.
          const option = options.option(current);
          if (!current.visible || current.forcedColors) {
            node.hidden = true;
            previous = undefined;
            return;
          }
          node.hidden = false;
          if (locale !== current.locale) {
            dispose();
            init(current);
            previous = undefined;
            previousMotion = undefined;
          }
          const colors = echartsColors(current);
          chart!.setOption({
            backgroundColor: colors.surface,
            color: [colors.accent, colors.muted, colors.negative],
            textStyle: { color: colors.text, fontFamily: current.font },
            ...option,
            // HTML tooltips would escape the host's presentation-only subtree.
            tooltip: { show: false },
            animation: !current.reducedMotion && option.animation !== false,
            ...(current.reducedMotion ? {
              animationDuration: 0, animationDurationUpdate: 0,
              series: (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []).map((series: Record<string, unknown>) => ({ ...series, animation: false, animationDuration: 0, animationDurationUpdate: 0, universalTransition: false })),
            } : {}),
          }, options.updateMode === "merge" && (previousMotion === undefined || previousMotion === current.reducedMotion)
            ? { notMerge: false, replaceMerge: ["series"], silent: true }
            : { notMerge: true, silent: true });
          previousMotion = current.reducedMotion;
          if (!previous || previous.width !== current.width || previous.height !== current.height || previous.pixelRatio !== current.pixelRatio) {
            chart!.resize({ width: current.width, height: current.height, silent: true });
          }
          previous = current;
        },
        dispose,
      };
    },
  };
}
