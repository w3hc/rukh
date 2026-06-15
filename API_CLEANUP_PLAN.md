# API Cleanup Implementation Plan

## Overview
This document outlines the cleanup and refactoring needed to improve code quality, maintainability, and consistency across the Rukh API.

---

## Phase 1: Error Handling & Validation

### 1.1 Global Exception Filter
**Priority: High**

- [ ] Create `src/filters/http-exception.filter.ts`
- [ ] Handle common exceptions: `BadRequestException`, `UnauthorizedException`, `NotFoundException`
- [ ] Standardize error response format
- [ ] Register globally in `main.ts`
- [ ] Remove redundant try-catch blocks from controllers

**Files to modify:**
- `src/context/context.controller.ts` (lines 75-83, 155-168, 214-228, etc.)
- `src/siwe/siwe.controller.ts` (lines 98-101)
- `src/app.controller.ts`

### 1.2 Password Validation Guard
**Priority: High**

- [ ] Create `src/guards/context-password.guard.ts`
- [ ] Implement password validation logic
- [ ] Apply guard to context endpoints using `@UseGuards()` decorator
- [ ] Remove duplicate password checks from controller methods

**Files to modify:**
- `src/context/context.controller.ts` (remove checks at lines 143, 209, 277, 352, 411, 489, 552, 624)

### 1.3 Consolidate DTOs
**Priority: Medium**

- [ ] Move inline DTOs from `web-reader.controller.ts` (lines 8-29) to `src/dto/web-reader.dto.ts`
- [ ] Create response DTOs for context endpoints
- [ ] Replace inline schema definitions with proper DTO classes
- [ ] Add proper validation decorators

**Files to create:**
- `src/dto/web-reader.dto.ts`
- `src/dto/context-response.dto.ts`

---

## Phase 2: Configuration & Constants

### 2.1 Centralize Configuration
**Priority: High**

- [ ] Create `src/config/rate-limit.config.ts`
- [ ] Move rate limit values from controllers:
  - Ask endpoint: 50 requests/hour
  - Web reader: 20 requests/minute
- [ ] Create `src/config/file-upload.config.ts`
- [ ] Move file size limits (currently 5MB hardcoded)
- [ ] Create `src/config/app.config.ts` for version info

**Files to modify:**
- `src/app.controller.ts` (line 46)
- `src/web-reader.controller.ts` (line 39)
- `src/context/context.controller.ts` (line 270)

### 2.2 Fix Version Inconsistency
**Priority: Low**

- [ ] Align versions between `main.ts` (line 38: `0.1.0-alpha`) and Swagger config (line 29: `0.2.0`)
- [ ] Consider reading version from `package.json`

---

## Phase 3: Code Quality Improvements

### 3.1 Dependency Injection
**Priority: Medium**

- [ ] Inject Logger instances instead of creating new ones in each controller
- [ ] Create LoggerModule if needed
- [ ] Update all controllers to use injected logger

**Files to modify:**
- `src/context/context.controller.ts` (line 43)
- `src/siwe/siwe.controller.ts` (line 18)
- `src/web/web-reader.controller.ts` (line 34)

### 3.2 Simplify Parameter Passing
**Priority: Medium**

- [ ] Refactor `app.controller.ts` ask method (lines 174-188)
- [ ] Reduce 7 individual parameters by using DTO fully
- [ ] Update service method signature accordingly

**Files to modify:**
- `src/app.controller.ts` (lines 174-188)
- `src/app.service.ts`

### 3.3 Clean Up Imports
**Priority: Low**

- [ ] Review unused imports across all controllers
- [ ] Remove `Header` import from `app.controller.ts` if not needed
- [ ] Ensure consistent import ordering

---

## Phase 4: Security & Best Practices

### 4.1 Password Security Review
**Priority: High**

- [ ] Document password hashing strategy
- [ ] Ensure passwords are hashed before storage
- [ ] Add password strength requirements
- [ ] Consider using bcrypt or similar

### 4.2 Add Request/Response Interceptors
**Priority: Low**

- [ ] Create logging interceptor for debugging
- [ ] Create transform interceptor for consistent response format
- [ ] Apply globally in `main.ts`

---

## Phase 5: Testing & Documentation

### 5.1 Update Tests
**Priority: High**

- [ ] Update unit tests after refactoring
- [ ] Add tests for new guards and filters
- [ ] Ensure e2e tests still pass

### 5.2 Update API Documentation
**Priority: Medium**

- [ ] Review all `@ApiResponse` decorators
- [ ] Ensure examples are accurate
- [ ] Add more detailed descriptions where needed

---

## Expected Benefits

- **Reduced code duplication**: ~40% reduction in controller code
- **Improved maintainability**: Centralized error handling and validation
- **Better type safety**: Proper DTOs everywhere
- **Easier testing**: Cleaner separation of concerns
- **Consistent API responses**: Standardized error formats
- **Better security**: Centralized password validation

---

## Estimated Effort

- **Phase 1**: 4-6 hours
- **Phase 2**: 2-3 hours
- **Phase 3**: 3-4 hours
- **Phase 4**: 2-3 hours
- **Phase 5**: 2-3 hours

**Total**: 13-19 hours

---

## Notes

- Prioritize phases 1 and 2 for maximum impact
- Consider creating feature branch for this refactoring
- Update this document as work progresses
- Test thoroughly after each phase
