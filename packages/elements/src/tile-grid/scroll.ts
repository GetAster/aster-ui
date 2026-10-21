/** Projects measured logical row offsets into a browser-safe scroll extent. */
export class TileScroll {
  readonly extent: number;
  readonly #logical: number;
  readonly #physical: number;

  constructor(rows: number, stride: number, height: number, gap: number) {
    const natural = Math.max(0, rows * stride - gap);
    this.extent = Math.min(8_000_000, natural);
    this.#logical = Math.max(0, natural - height);
    this.#physical = Math.max(0, this.extent - height);
  }

  logical(top: number): number {
    return this.#physical ? Math.max(0, Math.min(this.#physical, top)) * this.#logical / this.#physical : 0;
  }

  physical(top: number): number {
    return this.#logical ? Math.max(0, Math.min(this.#logical, top)) * this.#physical / this.#logical : 0;
  }

  rowTop(offset: number, top: number): number {
    return offset - (this.logical(top) - top);
  }
}
