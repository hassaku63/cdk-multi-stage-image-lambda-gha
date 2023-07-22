# for Mac M1
FROM --platform=linux/arm64 public.ecr.aws/lambda/python:3.9 AS build-arm64

COPY requirements.txt  .
RUN  pip3 install -r requirements.txt --target "${LAMBDA_TASK_ROOT}" --verbose
COPY . ${LAMBDA_TASK_ROOT}

# CMD [ "handler.handler" ]

# for Lambda Runtime
FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.9 AS build-amd64

# Install the function's dependencies using file requirements.txt
# from your project folder.
COPY requirements.txt  .
RUN  pip3 install -r requirements.txt --target "${LAMBDA_TASK_ROOT}" --verbose
COPY . ${LAMBDA_TASK_ROOT}

# CMD [ "handler.handler" ]
