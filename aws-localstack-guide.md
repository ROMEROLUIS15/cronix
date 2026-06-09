# Guía Definitiva de AWS Local: De 0 a 100 con LocalStack y AWS CLI

Esta guía interactiva te enseñará a configurar, levantar y usar un entorno local de AWS completo utilizando **Docker** y **LocalStack**. Cubre los servicios más demandados del mercado backend (S3, Lambda, RDS, ECS/EC2) y detalla cómo solucionar los problemas de compatibilidad del CLI moderno de AWS.

---

## 🛠️ Requisitos Previos

Antes de comenzar, debes tener instalado en tu sistema:
1. **Docker Desktop**: Necesario para ejecutar LocalStack en un contenedor.
   - [Descargar Docker](https://www.docker.com/products/docker-desktop/)
2. **AWS CLI v2**: La interfaz de comandos oficial para comunicarte con AWS.
   - [Descargar AWS CLI](https://aws.amazon.com/cli/)

---

## 🚀 Paso 1: Levantar el Entorno de AWS Local (LocalStack)

LocalStack simula la nube de AWS en tu computadora dentro de un contenedor Docker.

1. Abre una terminal (CMD o PowerShell) y ejecuta el siguiente comando para levantar el contenedor de LocalStack en segundo plano (`-d`):

```bash
docker run -d --name localstack -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock localstack/localstack:3.4.0
```

> [!NOTE]
> * **`-p 4566:4566`**: Mapea el puerto del S3/Lambda local a tu computadora.
> * **`-v /var/run/docker.sock`**: Permite a LocalStack crear otros contenedores temporalmente (necesario para correr Lambdas).
> * **`localstack/localstack:3.4.0`**: Usamos una versión específica y estable que no requiere tokens de autenticación obligatorios.

2. Para verificar que está corriendo correctamente, ejecuta:
```bash
docker ps
```
Deberías ver el contenedor `localstack` en estado "Up".

---

## ⚙️ Paso 2: Configurar tu AWS CLI

Debes configurar credenciales en tu CLI. Como es un entorno local simulado, usamos datos de prueba (`test`).

1. Ejecuta el comando de configuración:
```bash
aws configure
```

2. Introduce los siguientes valores cuando la terminal te los solicite:
   - **AWS Access Key ID**: `test`
   - **AWS Secret Access Key**: `test`
   - **Default region name**: `us-east-1`
   - **Default output format**: `json`

---

## 📦 Paso 3: Trabajando con Amazon S3

S3 (Simple Storage Service) sirve para guardar archivos (imágenes de perfil, PDFs, etc.).

### 1. Crear un Bucket
```bash
aws --endpoint-url=http://localhost:4566 s3 mb s3://cronix-test-bucket
```

### 2. Listar todos los Buckets creados
```bash
aws --endpoint-url=http://localhost:4566 s3 ls
```

---

### ⚠️ El Problema de AWS CLI v2 y el Error `x-amz-trailer`

Si intentas subir un archivo usando el comando estándar `cp`:
```bash
# ESTO PUEDE FALLAR en versiones de CLI modernas:
aws --endpoint-url=http://localhost:4566 s3 cp archivo.txt s3://cronix-test-bucket/
```
Te arrojará el siguiente error:
`An error occurred (InvalidRequest) when calling the PutObject operation: The value specified in the x-amz-trailer header is not supported`

**¿Por qué pasa?**
El AWS CLI v2 en sus versiones más recientes (2.34+) envía por defecto firmas matemáticas en pedazos ("checksum trailers") al subir archivos. LocalStack local no implementa esta lógica y rechaza la petición.

#### Solución 1: Configurar el CLI para desactivar Checksums (Permanente)
Ejecuta este comando para forzar al CLI a usar firmas tradicionales y evitar el error:
```bash
aws configure set default.s3.request_checksum_calculation when_supported
```

#### Solución 2: El Truco de la URL Prefirmada (Workaround Manual)
Si el comando anterior no surge efecto en tu versión de CLI, la forma infalible de subir un archivo de prueba es generar una **Presigned URL** y subirla con `curl`:

1. Genera la URL de subida temporal:
```bash
$url = aws --endpoint-url=http://localhost:4566 s3 presign s3://cronix-test-bucket/prueba.txt
```
2. Sube el archivo `prueba.txt` usando HTTP PUT convencional (que no añade cabeceras AWS conflictivas):
```bash
curl.exe -X PUT -T prueba.txt $url
```
3. Verifica que se subió:
```bash
aws --endpoint-url=http://localhost:4566 s3 ls s3://cronix-test-bucket/
```

---

## ⚡ Paso 4: Trabajando con AWS Lambda (Serverless)

AWS Lambda te permite ejecutar código backend sin configurar servidores.

### 1. Crear el código de la función
Crea un archivo local llamado `index.js` con una función sencilla:
```javascript
exports.handler = async (event) => {
    const name = event.name || "Mundo";
    return {
        statusCode: 200,
        body: JSON.stringify({ mensaje: `¡Hola ${name} desde AWS Lambda Local!` }),
    };
};
```

### 2. Empaquetar la Lambda
Las Lambdas se suben comprimidas. En PowerShell, comprime el archivo:
```powershell
Compress-Archive -Path index.js -DestinationPath funcion.zip -Force
```

### 3. Crear la Función Lambda en LocalStack
Crea el recurso asignándole un rol de prueba ficticio:
```bash
aws --endpoint-url=http://localhost:4566 lambda create-function `
    --function-name mi-primera-lambda `
    --runtime nodejs18.x `
    --zip-file fileb://funcion.zip `
    --handler index.handler `
    --role arn:aws:iam::000000000000:role/lambda-role
```

### 4. Invocar la Lambda Localmente
Ejecuta la lambda enviándole parámetros y guardando la respuesta en `salida.json`:
```bash
aws --endpoint-url=http://localhost:4566 lambda invoke `
    --function-name mi-primera-lambda `
    --payload '{"name": "Luis"}' `
    --cli-binary-format raw-in-base64-out `
    salida.json
```
Si lees `salida.json`, verás la respuesta generada por tu código.

---

## 🗄️ Paso 5: Entendiendo RDS (Bases de Datos Relacionales)

En AWS real, **Amazon RDS** se usa para levantar bases de datos PostgreSQL, MySQL, etc., de forma administrada.

### ¿Cómo practicar RDS localmente sin pagar?
* **LocalStack Pro (Pago)** soporta RDS de forma simulada.
* **En el Mundo Real (Gratis/Desarrollo)**: Los desarrolladores **no** simulan RDS en LocalStack. En su lugar, levantamos un contenedor Docker PostgreSQL estándar:
```bash
docker run --name postgres-local -e POSTGRES_PASSWORD=mi-password -p 5432:5432 -d postgres:15
```
* **Conexión en el código**: Tu aplicación TypeScript se conecta al host `localhost:5432` exactamente igual que como se conectaría a un host de RDS de producción en la nube. La única diferencia es la variable de entorno de conexión (`DATABASE_URL`).

---

## 🐳 Paso 6: Entendiendo ECS y Fargate (Contenedores)

**Amazon ECS (Elastic Container Service)** y **Fargate** se usan para subir una aplicación web entera (como tu Next.js) empaquetada en un contenedor Docker a producción.

### ¿Cómo practicarlo localmente?
1. Escribes un archivo `Dockerfile` en la raíz de tu proyecto para indicarle a Docker cómo construir tu app.
2. Construyes y pruebas la imagen localmente usando Docker:
```bash
# Construir la imagen
docker build -t mi-app-web .

# Ejecutarla localmente
docker run -p 3000:3000 mi-app-web
```
3. **Paso a Producción**: Cuando esto funciona en tu Docker local, el flujo de AWS es:
   - Subir esa imagen al registro **AWS ECR** (Elastic Container Registry).
   - Crear una "Task Definition" en **AWS ECS** que apunte a esa imagen.
   - Ejecutar la tarea usando **Fargate** (el cual aprovisiona el servidor automáticamente para correr tu contenedor).

---

## 🔄 Resumen de Equivalencias: Local vs Producción

Cuando pases tu código a producción, la lógica no cambia. Lo único que cambia son las variables de configuración de tus clientes SDK:

| Característica | Desarrollo Local (LocalStack / Docker) | Producción (AWS Real) |
| :--- | :--- | :--- |
| **S3 Endpoint** | `http://localhost:4566` | Automático (gestionado por AWS) |
| **S3 forcePathStyle** | `true` | `false` (usa estilo virtual host estándar) |
| **Credenciales** | `test` / `test` | IAM Roles asignados al servidor |
| **Database** | Docker Postgres Local | Instancia de Amazon RDS (PostgreSQL) |
| **Servidor Web** | `npm run dev` en tu máquina | Contenedor Docker en AWS ECS/Fargate |
| **Serverless** | Lambdas desplegadas en LocalStack | Lambdas desplegadas en la consola AWS/CDK |

---
> [!IMPORTANT]
> Guarda este archivo en tu workspace. Te servirá para repasar antes de cualquier entrevista técnica y le permitirá a cualquier agente de inteligencia artificial entender de inmediato tu flujo y setup de desarrollo.
