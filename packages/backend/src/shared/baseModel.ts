import {
  Constructor,
  Model,
  ModelOptions,
  Page,
  Pojo,
  QueryBuilder,
  QueryContext,
  QueryBuilderType,
  TransactionOrKnex
} from 'objection'
import { DbErrors } from 'objection-db-errors'
import { v4 as uuid } from 'uuid'

export interface Pagination {
  after?: string // Forward pagination: cursor.
  before?: string // Backward pagination: cursor.
  first?: number // Forward pagination: limit.
  last?: number // Backward pagination: limit.
}

export interface PageInfo {
  startCursor?: string
  endCursor?: string
  hasNextPage: boolean
  hasPreviousPage: boolean
}

class PaginationQueryBuilder<M extends Model, R = M[]> extends QueryBuilder<
  M,
  R
> {
  ArrayQueryBuilderType!: PaginationQueryBuilder<M, M[]>
  SingleQueryBuilderType!: PaginationQueryBuilder<M, M>
  MaybeSingleQueryBuilderType!: PaginationQueryBuilder<M, M | undefined>
  NumberQueryBuilderType!: PaginationQueryBuilder<M, number>
  PageQueryBuilderType!: PaginationQueryBuilder<M, Page<M>>

  /** TODO: Base64 encode/decode the cursors
   * Buffer.from("Hello World").toString('base64')
   * Buffer.from("SGVsbG8gV29ybGQ=", 'base64').toString('ascii')
   */

  /** getPage
   * The pagination algorithm is based on the Relay connection specification.
   * Please read the spec before changing things:
   * https://relay.dev/graphql/connections.htm
   * @param pagination Pagination - cursors and limits.
   * @returns Model[] An array of Models that form a page.
   */
  getPage(pagination?: Pagination): this {
    const tableName = this.modelClass().tableName
    if (
      typeof pagination?.before === 'undefined' &&
      typeof pagination?.last === 'number'
    )
      throw new Error("Can't paginate backwards from the start.")

    const first = pagination?.first || 20
    if (first < 0 || first > 100) throw new Error('Pagination index error')
    const last = pagination?.last || 20
    if (last < 0 || last > 100) throw new Error('Pagination index error')

    /**
     * Forward pagination
     */
    if (typeof pagination?.after === 'string') {
      return this.whereRaw(
        `("${tableName}"."createdAt", "${tableName}"."id") > (select "${tableName}"."createdAt" :: TIMESTAMP, "${tableName}"."id" from ?? where "${tableName}"."id" = ?)`,
        [this.modelClass().tableName, pagination.after]
      )
        .orderBy([
          { column: 'createdAt', order: 'asc' },
          { column: 'id', order: 'asc' }
        ])
        .limit(first)
    }

    /**
     * Backward pagination
     */
    if (typeof pagination?.before === 'string') {
      return this.whereRaw(
        `("${tableName}"."createdAt", "${tableName}"."id") < (select "${tableName}"."createdAt" :: TIMESTAMP, "${tableName}"."id" from ?? where "${tableName}"."id" = ?)`,
        [this.modelClass().tableName, pagination.before]
      )
        .orderBy([
          { column: 'createdAt', order: 'desc' },
          { column: 'id', order: 'desc' }
        ])
        .limit(last)
        .runAfter((models) => {
          if (Array.isArray(models)) {
            return models.reverse()
          }
        })
    }

    return this.orderBy([
      { column: 'createdAt', order: 'asc' },
      { column: 'id', order: 'asc' }
    ]).limit(first)
  }
}

export class PaginationModel extends DbErrors(Model) {
  QueryBuilderType!: PaginationQueryBuilder<this>
  static QueryBuilder = PaginationQueryBuilder
}

type ReadOnlyQueryBuilder<M extends Model> = QueryBuilderType<M> & {
  delete: never
  deleteById: never
  update: never
  updateAndFetch: never
  updateAndFetchById: never
  patch: never
  patchAndFetch: never
  insert: never
  insertAndFetch: never
  insertAndFetchById: never
  insertGraph: never
  insertGraphAndFetch: never
  upsertGraph: never
  upsertGraphAndFetch: never
}

export class ViewModel extends PaginationModel {
  static query<M extends Model>(
    this: Constructor<M>,
    trxOrKnex?: TransactionOrKnex
  ): ReadOnlyQueryBuilder<M> {
    return super.query<M>(trxOrKnex) as ReadOnlyQueryBuilder<M>
  }
}

export abstract class BaseModel extends PaginationModel {
  public static get modelPaths(): string[] {
    return [__dirname]
  }

  public id!: string
  public createdAt!: Date
  public updatedAt!: Date

  public $beforeInsert(context: QueryContext): void {
    super.$beforeInsert(context)
    this.id = this.id || uuid()
  }

  public $beforeUpdate(_opts: ModelOptions, _queryContext: QueryContext): void {
    this.updatedAt = new Date()
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    return {
      ...json,
      createdAt: json.createdAt.toISOString(),
      updatedAt: json.updatedAt.toISOString()
    }
  }
}
