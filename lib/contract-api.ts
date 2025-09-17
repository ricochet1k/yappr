import { safeGetDocuments, safeGetDocument, safeDocumentCreate, safeDocumentReplace, safeDocumentDelete } from './services/dapi-helpers'

export interface BaseDoc {
  $id: string;
  $ownerId: string;
  $createdAt?: number;
  $updatedAt?: number;
}

// Type-only symbol to associate index metadata to document interfaces
export declare const DocIndexSymbol: unique symbol;
export type IndicesOf<T extends {[DocIndexSymbol]: any}> = NonNullable<T[typeof DocIndexSymbol]>;

export type IndexFieldNames<I> = I extends Record<string, readonly (infer F)[]> ? F : never;
export type OrderDirection = 'asc' | 'desc';
export type ComparisonOp = '==' | '<' | '<=' | '>' | '>=';

type NonUndef<T> = T extends undefined ? never : T;
export type FieldNames<D, I> = Extract<IndexFieldNames<I>, string> & Extract<keyof D, string>;
export type FieldValue<D, K extends string> = K extends keyof D ? NonUndef<D[K]> : unknown;

// Strict where typing: must be a prefix over one of the defined indexes, in order.
// All preceding fields use '==', with the last field allowing range ops as well.
type EqClause<D, F extends string> = [F, '==', FieldValue<D, F>];
type RangeClause<D, F extends string> = [F, '<' | '<=' | '>' | '>=', FieldValue<D, F>];

type PrefixChain<D, T extends readonly string[]> =
  T extends []
    ? []
    : T extends readonly [infer F extends string, ...infer R extends readonly string[]]
      ? ([RangeClause<D, F>] | [EqClause<D, F>] | [EqClause<D, F>, ...PrefixChain<D, R>])
      : never;

type WhereForIndex<D, T extends readonly string[]> =
  T extends readonly [infer F1 extends string, ...infer R extends readonly string[]]
    ? ([EqClause<D, F1>] | [EqClause<D, F1>, ...PrefixChain<D, R>])
    : never;

type IndexTuples<I> = I[keyof I];
export type WhereForIndices<D, I> = IndexTuples<I> extends infer T
  ? T extends readonly string[]
    ? WhereForIndex<D, T>
    : never
  : never;

export type OrderBy<D, I> = [FieldNames<D, I>, OrderDirection];

export interface QueryOptions<D, I> {
  where?: WhereForIndices<D, I>;
  orderBy?: Array<OrderBy<D, I>>;
  limit?: number;
  startAfter?: string;
  startAt?: string;
}

export class DataContract {
  constructor(public readonly id: string) {}
}

type DocOnlyProps<D> = Omit<D, keyof BaseDoc>;

export class DocumentType<D, I extends Record<string, readonly string[]>> {
  constructor(
    public readonly contract: DataContract,
    public readonly typeName: string
  ) {}

  async query(options: QueryOptions<D, I> = {}) {
    const { where, orderBy, limit = 100, startAfter, startAt } = options;
    return safeGetDocuments(
      this.contract.id,
      this.typeName,
      (where as any) ?? null,
      (orderBy as any) ?? null,
      limit,
      startAfter ?? null,
      startAt ?? null
    );
  }

  async get(documentId: string) {
    return safeGetDocument(this.contract.id, this.typeName, documentId);
  }

  async create(options: { ownerId: string; data: Partial<DocOnlyProps<D>>; entropy: string; privateKeyWif: string }) {
    const { ownerId, data, entropy, privateKeyWif } = options;
    return safeDocumentCreate(
      this.contract.id,
      this.typeName,
      ownerId,
      JSON.stringify(data),
      entropy,
      privateKeyWif
    );
  }

  async replace(options: { documentId: string; ownerId: string; data: Partial<DocOnlyProps<D>>; revision: bigint; privateKeyWif: string }) {
    const { documentId, ownerId, data, revision, privateKeyWif } = options;
    return safeDocumentReplace(
      this.contract.id,
      this.typeName,
      documentId,
      ownerId,
      JSON.stringify(data),
      revision,
      privateKeyWif,
    );
  }

  async delete(options: { documentId: string; ownerId: string; privateKeyWif: string }) {
    const { documentId, ownerId, privateKeyWif } = options;
    return safeDocumentDelete(
      this.contract.id,
      this.typeName,
      documentId,
      ownerId,
      privateKeyWif,
    );
  }
}
