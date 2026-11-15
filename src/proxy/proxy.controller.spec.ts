import { ProxyController } from './proxy.controller';
import * as forwardModule from './forward';

jest.mock('./forward', () => ({
  forward: jest.fn().mockResolvedValue(undefined),
}));

describe('ProxyController', () => {
  let controller: ProxyController;
  const mockReq = {} as any;
  const mockRes = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ProxyController();
  });

  it('debe reenviar a booking en places, reservations y events', async () => {
    await controller.places(mockReq, mockRes);
    expect(forwardModule.forward).toHaveBeenCalledWith(expect.stringContaining('3001'), mockReq, mockRes);

    await controller.reservations(mockReq, mockRes);
    expect(forwardModule.forward).toHaveBeenCalledWith(expect.stringContaining('3001'), mockReq, mockRes);

    await controller.events(mockReq, mockRes);
    expect(forwardModule.forward).toHaveBeenCalledWith(expect.stringContaining('3001'), mockReq, mockRes);
  });

  it('debe reenviar a promo en promos', async () => {
    await controller.promos(mockReq, mockRes);
    expect(forwardModule.forward).toHaveBeenCalledWith(expect.stringContaining('3002'), mockReq, mockRes);
  });

  it('debe reenviar a game en rooms y game', async () => {
    await controller.rooms(mockReq, mockRes);
    expect(forwardModule.forward).toHaveBeenCalledWith(expect.stringContaining('3003'), mockReq, mockRes);

    await controller.game(mockReq, mockRes);
    expect(forwardModule.forward).toHaveBeenCalledWith(
      expect.stringContaining('3003'),
      mockReq,
      mockRes,
      expect.objectContaining({ upstreamPrefix: '/api/v1', passToken: true }),
    );
  });
});
