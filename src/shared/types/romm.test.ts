import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * The types against RomM's own schema, for every RomM this build supports.
 *
 * Everything else RomMix tests is code checked against code. This is the one
 * place a belief about somebody else's server is checked against what that
 * server says about itself: `romm.ts` is a transcription of RomM's schema made
 * by hand, and a field renamed upstream turns into `undefined` here with
 * nothing between it and a screen. `RommRom.fs_name` becoming `undefined` is
 * every game losing its filename; `SaveSchema.updated_at` going would silently
 * make every save look ancient and pull the wrong copy down.
 *
 * `schema/` holds one `/openapi.json` per RomM version, indented so that the
 * diff between two of them can be read.
 * Every one of them is checked, because RomMix is one binary that people point
 * at whatever server they are running — the version RomMix was written against
 * is not the version it has to work with. Add one with `npm run schema:fetch`;
 * removing one is how a version stops being supported, which is a decision
 * worth making in a commit rather than by drift.
 *
 * That is also what `?` means in `romm.ts` now, and the only thing it means: a
 * field some supported version does not send. A field declared without it must
 * exist in every document here.
 *
 * What binds a type to a schema is the doc comment above it, which already
 * names one: `GET /api/users/me (\`UserSchema\`)`. So the comments are the
 * mapping rather than a table kept beside it, and a type documented as one
 * thing and checked against another cannot happen.
 *
 * Not checked: whether a field RomM marks optional is declared optional here.
 * FastAPI leaves a field with a default out of `required` and then serialises
 * it anyway — `is_favorite` is exactly that — so the signal is noise, and a
 * check nobody can act on is a check that gets switched off.
 */

interface JsonSchema {
  type?: string
  /** Names the server insists a request body carries. Absent on a response. */
  required?: string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  anyOf?: JsonSchema[]
  $ref?: string
}

interface Document {
  version: string
  schemas: Record<string, JsonSchema>
}

const schemaDir = new URL('../../../schema/', import.meta.url)

/** Every RomM version committed under `schema/`, oldest first. */
const documents: Document[] = readdirSync(schemaDir)
  .filter((name) => name.startsWith('romm-') && name.endsWith('.json'))
  .map((name) => {
    const parsed = JSON.parse(readFileSync(new URL(name, schemaDir), 'utf8')) as {
      info: { version: string }
      components: { schemas: Record<string, JsonSchema> }
    }
    return { version: parsed.info.version, schemas: parsed.components.schemas }
  })
  .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))

const source = readFileSync(new URL('./romm.ts', import.meta.url), 'utf8')

/** One field as `romm.ts` declares it. */
interface Field {
  name: string
  type: string
  /** Declared with `?`: a field some supported version does not send. */
  optional: boolean
}

/** One interface, and the schemas its doc comment says it stands for. */
interface Transcription {
  name: string
  /** Schema names cited in the doc comment, whether or not a version has them. */
  cites: string[]
  /**
   * A body RomMix sends rather than one it reads, said by the word `body` in
   * the doc comment.
   *
   * The two are checked by opposite rules, so which one this is cannot be
   * guessed — `sent` below asserts the list, so a comment that stops saying it
   * fails here rather than quietly moving a type to the lenient check.
   */
  sends: boolean
  fields: Field[]
}

/**
 * Read the file as text rather than through the compiler.
 *
 * The same approach as `registry.test.ts`, and for the same reason: what is
 * being checked is a declaration, the file is written in one shape throughout,
 * and a regex over it costs nothing to run and nothing to install. It is
 * deliberately strict about that shape — an interface it cannot parse is an
 * interface it would otherwise silently skip, so `everything is transcribed`
 * below asserts the count.
 */
function transcriptions(): Transcription[] {
  const found: Transcription[] = []
  const pattern = /(\/\*\*[\s\S]*?\*\/)\s*export interface (\w+)[^{]*\{([\s\S]*?)\n\}/g
  for (const [, comment, name, body] of source.matchAll(pattern)) {
    // Only names some version defines as a schema: a doc comment also cites
    // things like `SimpleRomSchema.files`, and prose in backticks besides.
    const cites = [...comment.matchAll(/`(\w+)`/g)]
      .map((match) => match[1])
      .filter((cite) => documents.some((document) => cite in document.schemas))
    const fields: Field[] = []
    for (const line of body.split('\n')) {
      const field = /^ {2}(\w+)(\??): (.+?);?$/.exec(line)
      if (field) fields.push({ name: field[1], optional: field[2] === '?', type: field[3].trim() })
    }
    found.push({ name, cites: [...new Set(cites)], sends: /\bbody \(/.test(comment), fields })
  }
  return found
}

const all = transcriptions()

/**
 * The JSON types a value may have, with `anyOf` flattened and `$ref` followed.
 *
 * Following the reference matters for the enums: RomM declares `role` and a
 * file's `category` as references to a schema that is a string with an `enum`,
 * and treating a reference as an object regardless would call every one of
 * those a mismatch.
 */
function jsonTypes(
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>,
  depth = 0
): Set<string> {
  if (schema.anyOf) {
    return new Set(schema.anyOf.flatMap((one) => [...jsonTypes(one, schemas, depth + 1)]))
  }
  if (schema.$ref) {
    const target = schemas[schema.$ref.replace('#/components/schemas/', '')]
    // A guard rather than a limit worth tuning: RomM's schemas nest a couple
    // deep, and anything deeper is a reference cycle.
    if (!target || depth > 8) return new Set(['object'])
    return jsonTypes(target, schemas, depth + 1)
  }
  return new Set(schema.type ? [schema.type] : [])
}

/**
 * Is what RomM sends something this declaration can hold?
 *
 * Deliberately one-sided. A type that admits more than the server sends is not
 * a fault — `string | null` over a field RomM always fills is cautious, and
 * caution is what this file is written with. What is a fault is the other way
 * round: a declaration with no room for what arrives, which is a crash or a
 * wrong answer at the point of use.
 */
function accepts(
  declared: string,
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>
): boolean {
  const actual = jsonTypes(schema, schemas)
  // Nothing to compare against — RomM declares a few fields with no type at
  // all, and an assertion about those would be about this file, not about the
  // server.
  if (actual.size === 0) return true

  const nullable = declared.endsWith(' | null')
  const base = nullable ? declared.slice(0, -' | null'.length).trim() : declared
  if (actual.has('null') && !nullable) return false

  if (base.endsWith('[]')) {
    if (!actual.has('array')) return false
    const element = schema.anyOf?.find((one) => one.type === 'array')?.items ?? schema.items
    return element ? accepts(base.slice(0, -2), element, schemas) : true
  }

  const wanted = actual.has('null') ? new Set([...actual].filter((one) => one !== 'null')) : actual
  const holds = (...kinds: string[]): boolean => [...wanted].every((one) => kinds.includes(one))
  if (base === 'string') return holds('string')
  if (base === 'number') return holds('integer', 'number')
  if (base === 'boolean') return holds('boolean')
  // Anything else is one of this file's own types or a named union of string
  // literals; the former is checked against its own schema below.
  return holds('object', 'string')
}

/**
 * Is what RomMix sends something the server will take?
 *
 * The mirror of `accepts`, and it has to be a separate function rather than the
 * same one called the other way round. A response may arrive as `integer | null`
 * and be declared `number | null`; the same field on a request body is one
 * RomMix fills with a number and never with null, and calling that a mismatch
 * would be an assertion about caution rather than about correctness.
 */
function sendable(
  declared: string,
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>
): boolean {
  const actual = jsonTypes(schema, schemas)
  if (actual.size === 0) return true

  const nullable = declared.endsWith(' | null')
  const base = nullable ? declared.slice(0, -' | null'.length).trim() : declared
  // Sending null where the server does not admit it is the one direction that
  // is definitely wrong.
  if (nullable && !actual.has('null')) return false

  if (base.endsWith('[]')) {
    if (!actual.has('array')) return false
    const element = schema.anyOf?.find((one) => one.type === 'array')?.items ?? schema.items
    return element ? sendable(base.slice(0, -2), element, schemas) : true
  }

  const takes = (...kinds: string[]): boolean => kinds.some((one) => actual.has(one))
  if (base === 'string') return takes('string')
  if (base === 'number') return takes('integer', 'number')
  if (base === 'boolean') return takes('boolean')
  return takes('object', 'string')
}

describe('the schemas RomMix is checked against', () => {
  test('there is at least one, so an empty folder cannot pass by saying nothing', () => {
    assert.ok(documents.length > 0, 'schema/ should hold at least one RomM openapi.json')
  })

  test('the version the types were written against is one of them', () => {
    // Bumping the header without committing that version's document, or the
    // other way round, is how a check like this quietly starts describing
    // nothing.
    const claimed = /RomM (\d+\.\d+\.\d+) API/.exec(source)
    assert.notEqual(claimed, null, 'the file header should name the RomM version it mirrors')
    assert.ok(
      documents.some((document) => document.version === claimed?.[1]),
      `schema/ has no document for RomM ${claimed?.[1]}`
    )
  })

  test('each is the version its filename claims', () => {
    const mismatched = readdirSync(schemaDir)
      .filter((name) => name.startsWith('romm-') && name.endsWith('.json'))
      .filter((name) => {
        const parsed = JSON.parse(readFileSync(new URL(name, schemaDir), 'utf8')) as {
          info: { version: string }
        }
        return name !== `romm-${parsed.info.version}.json`
      })
    assert.deepEqual(mismatched, [])
  })
})

describe('the transcription', () => {
  test('everything is transcribed, so nothing is skipped by a parser that missed it', () => {
    const declared = source.matchAll(/^export interface (\w+)/gm)
    assert.deepEqual(
      all.map((one) => one.name),
      [...declared].map((match) => match[1])
    )
    assert.ok(all.every((one) => one.fields.length > 0))
  })

  test('the bodies RomMix sends are the ones held to the stricter rule', () => {
    // Named rather than counted: the two directions are checked by opposite
    // rules, and a type that slipped from one list to the other would go on
    // passing while checking the wrong thing about itself.
    assert.deepEqual(
      all.filter((one) => one.sends).map((one) => one.name),
      [
        'RommDeviceAuthInitPayload',
        'RommDeviceAuthTokenPayload',
        'RommRomUserPayload',
        'RommCollectionRomsPayload',
        'RommSaveDeletePayload',
        'RommStateDeletePayload',
        'RommPlaySessionPayload',
        'RommPlaySessionEntry'
      ]
    )
  })

  test('every type names a schema some supported version defines', () => {
    // `RomQuery` is the exception and stays one: query parameters are not a
    // response body, and RomM describes them per endpoint rather than as a
    // schema of their own.
    const unbound = all.filter((one) => one.cites.length === 0).map((one) => one.name)
    assert.deepEqual(unbound, ['RomQuery'])
  })
})

for (const { version, schemas } of documents) {
  describe(`every field RomMix reads, against RomM ${version}`, () => {
    for (const transcription of all) {
      if (transcription.cites.length === 0 || transcription.sends) continue

      for (const schemaName of transcription.cites) {
        // A schema this version does not have at all: the type is bound to a
        // later RomM, and only the versions that define it can speak for it.
        if (!(schemaName in schemas)) continue

        test(`${transcription.name} against ${schemaName}`, () => {
          const properties = schemas[schemaName].properties ?? {}
          const missing = transcription.fields
            .filter((field) => !field.optional && !(field.name in properties))
            .map((field) => field.name)
          assert.deepEqual(missing, [], `RomM ${version}'s ${schemaName} does not have these`)

          const wrong = transcription.fields
            .filter((field) => field.name in properties)
            .filter((field) => !accepts(field.type, properties[field.name], schemas))
            .map(
              (field) =>
                `${field.name}: ${field.type} (server: ${[
                  ...jsonTypes(properties[field.name], schemas)
                ].join('|')})`
            )
          assert.deepEqual(wrong, [], `RomM ${version}'s ${schemaName} sends something else`)
        })
      }
    }
  })
}

/**
 * The other direction, and the one the fake server cannot stand in for.
 *
 * `test/app/server.ts` is written from the same reading of RomM as the client
 * is, so it takes whatever RomMix sends and a scenario goes green over a body
 * no real server would accept. What settles it is the same thing that settles a
 * response: the document RomM publishes about itself.
 */
for (const { version, schemas } of documents) {
  describe(`every body RomMix sends, against RomM ${version}`, () => {
    for (const transcription of all) {
      if (!transcription.sends) continue

      for (const schemaName of transcription.cites) {
        if (!(schemaName in schemas)) continue

        test(`${transcription.name} against ${schemaName}`, () => {
          const schema = schemas[schemaName]
          const properties = schema.properties ?? {}

          // A field RomM insists on. Optional here means RomMix may leave it
          // out, so an optional declaration of a required field is the same
          // fault as not declaring it — a 422 the first time a real server
          // sees it, and nothing before that.
          const withheld = (schema.required ?? []).filter(
            (name) => !transcription.fields.some((field) => field.name === name && !field.optional)
          )
          assert.deepEqual(withheld, [], `RomM ${version}'s ${schemaName} insists on these`)

          // A field RomM has no place for. Harmless on a lenient server and a
          // rejection on a strict one, and either way it is a name that has
          // moved without this following it.
          const unknown = transcription.fields
            .filter((field) => !(field.name in properties))
            .map((field) => field.name)
          assert.deepEqual(unknown, [], `RomM ${version}'s ${schemaName} has no such fields`)

          const wrong = transcription.fields
            .filter((field) => field.name in properties)
            .filter((field) => !sendable(field.type, properties[field.name], schemas))
            .map(
              (field) =>
                `${field.name}: ${field.type} (server takes: ${[
                  ...jsonTypes(properties[field.name], schemas)
                ].join('|')})`
            )
          assert.deepEqual(wrong, [], `RomM ${version}'s ${schemaName} will not take these`)
        })
      }
    }
  })
}
