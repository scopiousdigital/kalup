// Association labels and the plain associations between two objects, as `associations.ts` in the folder of object files
// carries them, in HubSpot terms. The app imports the file for typed label names; the tool parses it and never runs it.

/**
 * One association definition between two objects. With `label` it is a label: a pair of HubSpot association types, one
 * per direction. Without it, it is the plain association of a pair that has no HubSpot-defined one, as between a custom
 * object and another object.
 */
export interface AssociationSpec {
  /** The object the label reads from, as `objects` names it: a standard object's name or a custom object's name. */
  from: string
  /**
   * The label of the other direction, as HubSpot shows it on a `to` record. HubSpot uses `label` on both sides when it
   * is left out.
   * @default the label
   */
  inverseLabel?: string
  /**
   * The label HubSpot shows on a `from` record. Left out, the definition is the plain association between the two
   * objects.
   */
  label?: string
  /**
   * The internal name HubSpot stores for both directions: unique in the portal, never changed. HubSpot's UI makes it from
   * the label, in lower case with spaces as underscores.
   */
  name: string
  /** The other object, as `objects` names it. */
  to: string
}

export type DefinedAssociations<A extends Record<string, AssociationSpec>> = { readonly [K in keyof A]: A[K] }

/**
 * The association labels of a project, keyed by a name the app chooses. Their internal names keep their literal types,
 * so `Associations.signer.name` is typed `'signer'`.
 */
export function defineAssociations<const A extends Record<string, AssociationSpec>>(spec: A): DefinedAssociations<A> {
  return spec
}

/** The internal names of a project's associations as a union, `AssociationName<typeof Associations>`. */
export type AssociationName<A extends Record<string, { readonly name: string }>> = A[keyof A]['name']
