// 100,000 clients, generated the same way every time from a seed: a set
// too large to load, for pickers that search on the server.

import { random } from "./time.ts";

export interface Client {
  id: number;
  name: string;
  city: string;
  country: string;
  industry: string;
}

const FIRST = ["Northwind", "Bluefin", "Copper", "Juniper", "Harbor", "Meridian", "Saffron", "Granite", "Larkspur", "Orchard",
  "Beacon", "Cinder", "Driftwood", "Evergreen", "Foxglove", "Hollow", "Ironbark", "Kestrel", "Lumen", "Marigold",
  "Nimbus", "Oakridge", "Pinecrest", "Quarry", "Riverstone", "Silverline", "Tidewater", "Umber", "Vantage", "Willow"];
const SECOND = ["Analytics", "Bakery", "Builders", "Capital", "Cycles", "Dental", "Design", "Energy", "Foods", "Freight",
  "Health", "Hotels", "Insurance", "Labs", "Logistics", "Media", "Motors", "Outdoor", "Partners", "Pharma",
  "Press", "Realty", "Robotics", "Studios", "Systems", "Textiles", "Travel", "Ventures", "Water", "Works"];
const SUFFIX = ["Ltd", "GmbH", "SA", "BV", "Inc", "AB", "Oy", "SpA", "AS", "Co"];
const PLACES: readonly (readonly [string, readonly string[]])[] = [
  ["United Kingdom", ["London", "Manchester", "Leeds", "Bristol", "Glasgow", "Cardiff"]],
  ["Germany", ["Berlin", "Hamburg", "Munich", "Cologne", "Leipzig"]],
  ["France", ["Paris", "Lyon", "Marseille", "Toulouse", "Nantes"]],
  ["Netherlands", ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"]],
  ["Sweden", ["Stockholm", "Gothenburg", "Malmö", "Uppsala"]],
  ["Spain", ["Madrid", "Barcelona", "Valencia", "Seville", "Bilbao"]],
  ["Italy", ["Rome", "Milan", "Turin", "Bologna", "Naples"]],
  ["Norway", ["Oslo", "Bergen", "Trondheim"]],
  ["Finland", ["Helsinki", "Espoo", "Tampere"]],
  ["Ireland", ["Dublin", "Cork", "Galway"]],
];
const INDUSTRY = ["Retail", "Manufacturing", "Healthcare", "Finance", "Logistics", "Hospitality", "Energy", "Media", "Public sector", "Education"];

export function clients(count: number, seed = 11): Client[] {
  const r = random(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const out: Client[] = [];
  for (let id = 1; id <= count; id++) {
    const [country, cities] = pick(PLACES);
    out.push({ id, name: `${pick(FIRST)} ${pick(SECOND)} ${pick(SUFFIX)}`, city: pick(cities), country, industry: pick(INDUSTRY) });
  }
  return out;
}
