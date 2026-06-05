/**
 * Binary min-heap for efficient priority queue operations.
 */
export class MinHeap {
  #heap = [];
  #indices = new Map();
  #comparator;

  /**
   * @param {Function} comparator - Returns negative if a < b, zero if equal, positive if a > b
   */
  constructor(comparator = (a, b) => a - b) {
    this.#comparator = comparator;
  }

  get size() {
    return this.#heap.length;
  }

  get isEmpty() {
    return this.#heap.length === 0;
  }

  /**
   * View minimum element without removing.
   * @returns {any}
   */
  peek() {
    return this.#heap[0];
  }

  /**
   * Insert element into heap.
   * @param {any} item
   */
  insert(item) {
    this.#heap.push(item);
    this.#indices.set(item, this.#heap.length - 1);
    this.#bubbleUp(this.#heap.length - 1);
  }

  /**
   * Remove and return minimum element.
   * @returns {any}
   */
  extractMin() {
    if (this.isEmpty) return undefined;

    const min = this.#heap[0];
    const last = this.#heap.pop();
    this.#indices.delete(min);

    if (!this.isEmpty) {
      this.#heap[0] = last;
      this.#indices.set(last, 0);
      this.#bubbleDown(0);
    }

    return min;
  }

  /**
   * Check if item exists in heap.
   * @param {any} item
   * @returns {boolean}
   */
  has(item) {
    return this.#indices.has(item);
  }

  /**
   * Update an item's position after its priority changed.
   * @param {any} item
   */
  updatePriority(item) {
    const index = this.#indices.get(item);
    if (index === undefined) return;
    this.#bubbleUp(index);
    this.#bubbleDown(index);
  }

  /**
   * Remove specific item from heap.
   * @param {any} item
   * @returns {boolean}
   */
  remove(item) {
    const index = this.#indices.get(item);
    if (index === undefined) return false;

    const lastIndex = this.#heap.length - 1;
    if (index !== lastIndex) {
      this.#swap(index, lastIndex);
      this.#heap.pop();
      this.#indices.delete(item);
      this.#bubbleUp(index);
      this.#bubbleDown(index);
    } else {
      this.#heap.pop();
      this.#indices.delete(item);
    }

    return true;
  }

  /**
   * Clear all items.
   */
  clear() {
    this.#heap = [];
    this.#indices.clear();
  }

  #bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.#comparator(this.#heap[index], this.#heap[parentIndex]) >= 0) break;
      this.#swap(index, parentIndex);
      index = parentIndex;
    }
  }

  #bubbleDown(index) {
    const length = this.#heap.length;
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length &&
        this.#comparator(this.#heap[leftChild], this.#heap[smallest]) < 0) {
        smallest = leftChild;
      }
      if (rightChild < length &&
        this.#comparator(this.#heap[rightChild], this.#heap[smallest]) < 0) {
        smallest = rightChild;
      }

      if (smallest === index) break;
      this.#swap(index, smallest);
      index = smallest;
    }
  }

  #swap(i, j) {
    [this.#heap[i], this.#heap[j]] = [this.#heap[j], this.#heap[i]];
    this.#indices.set(this.#heap[i], i);
    this.#indices.set(this.#heap[j], j);
  }
}
