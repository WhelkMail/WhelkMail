export type Sexp = string | number | null | Sexp[]

function skipSpaces(input: string, state: { index: number }): void {
  while (state.index < input.length && input[state.index] === ' ') {
    state.index += 1
  }
}

function parseValue(input: string, state: { index: number }): Sexp {
  skipSpaces(input, state)
  const char = input[state.index]
  if (char === '(') {
    state.index += 1
    const items: Sexp[] = []
    while (state.index < input.length) {
      skipSpaces(input, state)
      if (input[state.index] === ')') {
        state.index += 1
        break
      }
      items.push(parseValue(input, state))
    }
    return items
  }
  if (char === '"') {
    state.index += 1
    let value = ''
    while (state.index < input.length) {
      const current = input[state.index]
      state.index += 1
      if (current === '\\') {
        value += input[state.index] ?? ''
        state.index += 1
        continue
      }
      if (current === '"') {
        break
      }
      value += current
    }
    return value
  }
  const start = state.index
  while (state.index < input.length) {
    const current = input[state.index]
    if (current === ' ' || current === '(' || current === ')') {
      break
    }
    state.index += 1
  }
  const atom = input.slice(start, state.index)
  if (atom.toUpperCase() === 'NIL') {
    return null
  }
  if (/^-?\d+$/.test(atom)) {
    return Number(atom)
  }
  return atom
}

export function extractBodyStructure(line: string): Sexp | null {
  const marker = line.toUpperCase().indexOf('BODYSTRUCTURE')
  if (marker < 0) {
    return null
  }
  const start = line.indexOf('(', marker + 'BODYSTRUCTURE'.length)
  if (start < 0) {
    return null
  }
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = start; index < line.length; index += 1) {
    const char = line[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
  }
  if (end < 0) {
    return null
  }
  const state = { index: 0 }
  return parseValue(line.slice(start, end + 1), state)
}

export function bodyStructureHasAttachment(structure: Sexp | null): boolean {
  if (structure === null) {
    return false
  }
  if (Array.isArray(structure)) {
    for (const item of structure) {
      if (typeof item === 'string' && item.toLowerCase() === 'attachment') {
        return true
      }
      if (bodyStructureHasAttachment(item)) {
        return true
      }
    }
  }
  return false
}
