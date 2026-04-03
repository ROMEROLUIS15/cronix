# 🎨 Cronix: UX Engineering & Interaction Design

This document details the high-fidelity interaction patterns implemented in Cronix to ensure a premium and frictionless user experience.

## 🖱️ Draggable Assistant (Luis IA)

To prevent the Floating Action Button (FAB) from obstructing critical dashboard information or form fields, we implemented a custom vertical drag system.

### Interaction Pattern: Vertical-Only Magnet
- **Constraint**: The FAB is locked to the right edge of the viewport to maintain thumb-friendly accessibility for right-handed users.
- **Freedom**: The user can drag the FAB vertically across the entire screen height.
- **Visual Feedback**:
    - **Scale**: The button scales up (1.1x) during drag and has a more pronounced shadow.
    - **Spring Animation**: Uses a spring physics engine (stiffness: 300, damping: 30) for natural movement without "jitter".
    - **Draggable Handle**: A subtle visual indicator at the top of the button suggests it can be moved.

## ⚙️ Persistent UI State

Using **UX Persistence** techniques, we ensure the interface respects user intent across sessions.

### Implementation: LocalStorage Bridge
- **Key**: `cronix-assistant-y`
- **Behavior**: Every time a drag operation ends, the new `y` coordinate is persisted.
- **Hydration**: On mount, the component checks for a stored position. We use a "Hydration Guard" (`isLoaded` state) to prevent visual "jumps" during initial render.

## 🛠️ Technology Stack
- **Framer Motion**: Used for motion-driven logic and physics-based animations.
- **React Hooks**: `useMotionValue` and `useSpring` to manage interaction state without unnecessary re-renders.
- **Web Storage API**: To bridge the gap between sessions.
