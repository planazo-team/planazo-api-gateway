import axios from 'axios';
import {
  createPlace,
  cuentaPorId,
  googleAccount,
  ownedPlaceId,
  registrarNegocio,
  type Who,
} from './booking.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BookingClient', () => {
  const whoUser: Who = {
    sub: 'u1',
    name: 'Juan Perez',
    role: 'cliente',
  };

  const whoNegocio: Who = {
    sub: 'n1',
    name: 'Mi Bar',
    role: 'negocio',
    placeId: 'p100',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ownedPlaceId', () => {
    it('debe retornar el id del lugar si booking responde 200 con data.id', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { id: 'p7' },
      });

      const res = await ownedPlaceId(whoNegocio);
      expect(res).toBe('p7');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/places/owned'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-user-id': 'n1',
            'x-user-role': 'negocio',
            'x-user-place-id': 'p100',
          }),
        }),
      );
    });

    it('debe retornar null si status no es 200 o data no tiene id', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 404,
        data: null,
      });

      const res = await ownedPlaceId(whoUser);
      expect(res).toBeNull();
    });

    it('debe retornar null si la llamada lanza excepción', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
      const res = await ownedPlaceId(whoUser);
      expect(res).toBeNull();
    });
  });

  describe('createPlace', () => {
    it('debe retornar la respuesta exitosa de booking', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: { id: 'p1', name: 'Nuevo Bar' },
      });

      const res = await createPlace(whoNegocio, { name: 'Nuevo Bar' });
      expect(res.status).toBe(201);
      expect(res.data).toEqual({ id: 'p1', name: 'Nuevo Bar' });
    });

    it('debe retornar 502 si ocurre un error de red o timeout', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Timeout'));
      const res = await createPlace(whoNegocio, { name: 'Nuevo Bar' });
      expect(res.status).toBe(502);
      expect(res.data).toEqual({
        code: 'SERVICIO_NO_DISPONIBLE',
        message: 'No se pudo contactar el servicio de lugares.',
      });
    });
  });

  describe('googleAccount', () => {
    it('debe mapear cuenta encontrada/creada exitosamente', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: {
          accountId: 'g123456789012',
          name: 'Juan Perez',
          negocio: true,
        },
      });

      const res = await googleAccount({
        googleSub: '12345',
        email: 'juan@test.com',
        name: 'Juan Perez',
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.accountId).toBe('g123456789012');
      expect(res.negocio).toBe(true);
    });

    it('debe retornar ok: false si status no es 200', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 400,
        data: { code: 'DATOS_INVALIDOS' },
      });

      const res = await googleAccount({
        googleSub: '12345',
        email: 'juan@test.com',
        name: 'Juan Perez',
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
    });

    it('debe retornar status 0 si la llamada falla por red', async () => {
      mockedAxios.request.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await googleAccount({
        googleSub: '12345',
        email: 'juan@test.com',
        name: 'Juan Perez',
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
    });
  });

  describe('cuentaPorId', () => {
    it('debe consultar la cuenta por su ID', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: {
          accountId: 'gABCDEFGHIJK',
          name: 'Empresa S.A.',
          negocio: true,
        },
      });

      const res = await cuentaPorId('gABCDEFGHIJK');
      expect(res.ok).toBe(true);
      expect(res.accountId).toBe('gABCDEFGHIJK');
    });
  });

  describe('registrarNegocio', () => {
    it('debe enviar datos de registro de negocio', async () => {
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: {
          accountId: 'gABCDEFGHIJK',
          negocio: true,
        },
      });

      const res = await registrarNegocio('gABCDEFGHIJK', {
        legalName: 'Restaurante El Sol SAS',
        nit: '900123456-1',
        phone: '3001234567',
        acceptTerms: true,
      });

      expect(res.ok).toBe(true);
      expect(res.negocio).toBe(true);
    });
  });
});
