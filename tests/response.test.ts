import { success, failure, ApiResponse } from '../src/utils/response';

describe('response helpers', () => {
  function createMockRes() {
    const res: any = {};
    res.statusCode = 0;
    res.payload = undefined;
    res.status = function (code: number) {
      this.statusCode = code;
      return this;
    };
    res.json = function (payload: ApiResponse) {
      this.payload = payload;
      return this;
    };
    return res as any;
  }

  it('success() builds success payload', () => {
    const res = createMockRes();
    success(res as any, { hello: 'world' }, 'OK', 200, { page: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.message).toBe('OK');
    expect(res.payload.data).toEqual({ hello: 'world' });
    expect(res.payload.meta).toEqual({ page: 1 });
  });

  it('failure() builds error payload', () => {
    const res = createMockRes();
    failure(res as any, 'Bad Request', 400, { field: 'name' });
    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    expect(res.payload.message).toBe('Bad Request');
    expect(res.payload.error).toEqual({ message: 'Bad Request', details: { field: 'name' } });
  });
});
