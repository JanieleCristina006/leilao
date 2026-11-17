import { checkFrontendOrigin } from './frontend-origin.js';

describe('Socket.IO frontend origin', () => {
  const original = process.env.FRONTEND_ORIGIN;

  afterEach(() => {
    if (original === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = original;
  });

  it('reads configured origins when a request arrives', () => {
    process.env.FRONTEND_ORIGIN = 'https://front.example.com';
    const callback = jest.fn();

    checkFrontendOrigin('https://front.example.com', callback);
    expect(callback).toHaveBeenCalledWith(null, true);
    checkFrontendOrigin('https://other.example.com', callback);
    expect(callback).toHaveBeenLastCalledWith(null, false);
    checkFrontendOrigin('http://localhost:5173', callback);
    expect(callback).toHaveBeenLastCalledWith(null, true);
  });
});
