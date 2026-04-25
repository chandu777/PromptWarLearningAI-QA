import '@testing-library/jest-dom';

// jsdom does not implement scrollIntoView — mock it so chat tests don't crash
window.HTMLElement.prototype.scrollIntoView = vi.fn();
