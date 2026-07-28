```markdown
# blast Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `blast` TypeScript codebase. You'll learn about file naming, import/export styles, commit patterns, and how to write and run tests. This guide is designed to help contributors maintain consistency and quality across the project.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myComponent.ts`, `userService.ts`

### Imports
- Use **relative imports** for referencing other files/modules.
  - Example:
    ```typescript
    import { myFunction } from './utils';
    ```

### Exports
- Use **named exports** for all modules.
  - Example:
    ```typescript
    export function myFunction() { ... }
    export const MY_CONSTANT = 42;
    ```

### Commit Patterns
- Commit messages are **freeform** with no enforced prefixes.
- Average commit message length: ~63 characters.
  - Example:
    ```
    Add user authentication logic to login service
    ```

## Workflows

### Adding a New Module
**Trigger:** When creating a new feature or utility module.
**Command:** `/add-module`

1. Create a new file using camelCase naming (e.g., `newFeature.ts`).
2. Write your TypeScript code, using named exports.
3. Use relative imports to bring in dependencies.
4. Add corresponding tests in a `.test.ts` file.
5. Commit your changes with a clear, descriptive message.

### Writing and Running Tests
**Trigger:** When adding or updating functionality.
**Command:** `/run-tests`

1. Create a test file named with the pattern `*.test.ts` (e.g., `myFunction.test.ts`).
2. Write your test cases using the project's preferred (unknown) testing framework.
3. Run the test suite using the project's test runner (see project documentation for commands).
4. Ensure all tests pass before committing.

## Testing Patterns

- Test files follow the `*.test.*` naming pattern (e.g., `utils.test.ts`).
- The specific testing framework is **unknown**; check the project documentation or existing tests for details.
- Place test files alongside the modules they test or in a dedicated test directory, as per project structure.

## Commands
| Command       | Purpose                                      |
|---------------|----------------------------------------------|
| /add-module   | Guide for adding a new module                |
| /run-tests    | Instructions for writing and running tests   |
```
