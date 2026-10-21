import { init as createChart } from "echarts";
import type { EChartsRuntime } from "@getaster/elements";

export const init: EChartsRuntime["init"] = createChart;
