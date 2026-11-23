import type { FunctionalComponent } from 'vue'

/** A stand-in drawn by `render`, which reads the attributes itself instead of leaving them on its root. */
export function bareStub(render: FunctionalComponent): FunctionalComponent {
  render.inheritAttrs = false
  return render
}
