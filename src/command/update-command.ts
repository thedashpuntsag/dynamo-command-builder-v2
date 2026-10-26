import { CustomUpdateCmdInput, customUpdateCmdInputSch } from '@/types';
import type { UpdateCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates input and builds an AWS SDK DocumentClient `UpdateCommandInput`.
 *
 * ### Process Flow:
 * 1. Validate input using the update-command Zod schema.
 * 2. Merge caller-provided names and values, rejecting conflicts.
 * 3. Use an explicit update expression or generate a SET expression.
 * 4. Generate collision-safe aliases for item-based updates.
 * 5. Resolve expression-name tokens, giving explicit mappings precedence.
 * 6. Validate missing and unused expression tokens.
 * 7. Attach response options and return `UpdateCommandInput`.
 *
 * ### Notes:
 * - Uses native JavaScript values with `@aws-sdk/lib-dynamodb`.
 * - Generated updates treat item property names as literal attributes.
 * - Explicit expressions support DynamoDB SET, REMOVE, ADD, and DELETE.
 * - Explicit alias mappings override inferred shorthand mappings.
 * - Legacy extra expression maps are retained for compatibility.
 * - The builder does not execute AWS operations.
 * - The AWS service remains responsible for full expression validation.
 *
 * @example Generate a SET expression from an item patch
 * ```ts
 * const input = buildValidatedUpdateCommand({
 *   tableName: 'Users',
 *   key: { userId: 'user-1' },
 *   item: { name: 'Dash', active: true },
 *   returnValues: 'ALL_NEW'
 * })
 *
 * // input:
 * // {
 * //   TableName: 'Users',
 * //   Key: { userId: 'user-1' },
 * //   UpdateExpression: 'SET #updateAttr0 = :updateVal0, #updateAttr1 = :updateVal1',
 * //   ExpressionAttributeNames: { '#updateAttr0': 'name', '#updateAttr1': 'active' },
 * //   ExpressionAttributeValues: { ':updateVal0': 'Dash', ':updateVal1': true },
 * //   ReturnValues: 'ALL_NEW'
 * // }
 * ```
 *
 * @param input The custom update request.
 * @returns A validated DocumentClient `UpdateCommandInput`.
 * @throws On schema, mapping, or expression-token validation errors.
 */
export function buildValidatedUpdateCommand(input: CustomUpdateCmdInput): UpdateCommandInput {
  try {
    const parsed = customUpdateCmdInputSch.parse(input);

    const providedNames = mergeMappings(
      parsed.expressionAttributeNames ?? {},
      parsed.extraExpAttributeNames ?? {},
      'expression attribute name'
    );

    const values = mergeMappings(
      parsed.expressionAttributeValues ?? {},
      parsed.extraExpAttributeValues ?? {},
      'expression attribute value'
    );

    const generatedNames: Record<string, string> = {};

    let updateExpression = parsed.updateExpression ?? '';

    if (parsed.item !== undefined) {
      const updateParts: string[] = [];

      const reservedNames = new Set([
        ...Object.keys(providedNames),
        ...getTokens(parsed.conditionExpression ?? '', /#[A-Za-z0-9_]+/g),
      ]);

      const reservedValues = new Set([
        ...Object.keys(values),
        ...getTokens(parsed.conditionExpression ?? '', /:[A-Za-z0-9_]+/g),
      ]);

      let index = 0;

      for (const [attributeName, value] of Object.entries(parsed.item)) {
        let nameToken: string;
        let valueToken: string;

        do {
          nameToken = `#updateAttr${index}`;
          valueToken = `:updateVal${index}`;
          index++;
        } while (reservedNames.has(nameToken) || reservedValues.has(valueToken));

        generatedNames[nameToken] = attributeName;
        values[valueToken] = value;

        reservedNames.add(nameToken);
        reservedValues.add(valueToken);

        updateParts.push(`${nameToken} = ${valueToken}`);
      }

      updateExpression = `SET ${updateParts.join(', ')}`;
    }

    const expressions = [updateExpression, parsed.conditionExpression ?? ''].join(' ');

    const referencedNames = getTokens(expressions, /#[A-Za-z0-9_]+/g);

    const referencedValues = getTokens(expressions, /:[A-Za-z0-9_]+/g);

    // Resolve caller mappings first, followed by generated aliases.
    const names: Record<string, string> = {
      ...generatedNames,
      ...providedNames,
    };

    // Preserve the existing library convention where #status
    // without an explicit mapping is interpreted as "status".
    for (const token of referencedNames) {
      if (!Object.hasOwn(names, token)) {
        names[token] = token.slice(1);
      }
    }

    for (const token of Object.keys(names)) {
      if (!referencedNames.has(token)) {
        throw new Error(`Unused expression attribute name: "${token}".`);
      }
    }

    for (const token of referencedValues) {
      if (!Object.hasOwn(values, token)) {
        throw new Error(`Missing expression attribute value: "${token}".`);
      }
    }

    for (const token of Object.keys(values)) {
      if (!referencedValues.has(token)) {
        throw new Error(`Unused expression attribute value: "${token}".`);
      }
    }

    const commandInput: UpdateCommandInput = {
      TableName: parsed.tableName,
      Key: parsed.key,
      UpdateExpression: updateExpression,
      ReturnValues: parsed.returnValues,
      ReturnValuesOnConditionCheckFailure: parsed.returnValuesOnConditionCheckFailure,
      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
      ReturnItemCollectionMetrics: parsed.returnItemCollectionMetrics,
    };

    if (parsed.conditionExpression) {
      commandInput.ConditionExpression = parsed.conditionExpression;
    }

    if (Object.keys(names).length > 0) {
      commandInput.ExpressionAttributeNames = names;
    }

    if (Object.keys(values).length > 0) {
      commandInput.ExpressionAttributeValues = values;
    }

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated UpdateCommand:', error);

    throw error;
  }
}

const getTokens = (expression: string, pattern: RegExp): Set<string> => new Set(expression.match(pattern) ?? []);

const mergeMappings = <T>(primary: Record<string, T>, extra: Record<string, T>, label: string): Record<string, T> => {
  const merged = { ...primary };

  for (const [token, value] of Object.entries(extra)) {
    if (Object.hasOwn(merged, token) && !Object.is(merged[token], value)) {
      throw new Error(`Conflicting ${label} mapping for "${token}".`);
    }

    merged[token] = value;
  }

  return merged;
};
