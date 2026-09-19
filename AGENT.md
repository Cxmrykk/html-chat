# Agent Instructions

This is a zero-runtime-dependency, no-framework, single-HTML-file chat client.
Everything below is a hard rule unless the user says otherwise.

## 1. Cohesion, not line count

There is **no arbitrary line limit**. Line count is not a proxy for cohesion.
The rule is:

* One module = one responsibility, explainable in a single sentence.
* If you cannot write that sentence without the word "and", split the module.
* A 15-line module is fine. A 400-line module is fine if it is one coherent thing.

## 2. Dependency direction

Imports flow one way only:

